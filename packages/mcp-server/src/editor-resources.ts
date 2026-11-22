import { type McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  ErrorCode,
  McpError,
  SubscribeRequestSchema,
  UnsubscribeRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { EDITOR_RESOURCES, type EditorResource, isValidClientId } from '@prompt-studio/control-protocol';
import type { StudioCaller } from './client';

const MIME_TYPE = 'application/json';
const descriptions: Record<EditorResource, string> = {
  document: 'The open prompt, including unapplied writing.',
  sections: 'The sections of the open prompt in document order.',
  findings: 'The latest Verify findings and their freshness.',
  events: 'The latest 20 editor actions in this tab.',
};

function resourceUri(browserId: string, resource: EditorResource) {
  return `studio://editor/${browserId}/${resource}`;
}

function parseAddress(uri: string) {
  const match = /^studio:\/\/editor\/([^/]+)\/([^/]+)$/.exec(uri);
  const browserId = match?.[1];
  const resource = EDITOR_RESOURCES.find((name) => name === match?.[2]);
  if (!isValidClientId(browserId) || !resource) {
    throw new McpError(ErrorCode.InvalidParams, 'Choose an editor resource URI from resources/list.');
  }
  return { browserId, resource };
}

export function registerEditorResources(server: McpServer, studio: () => StudioCaller, subscribe: boolean) {
  const template = new ResourceTemplate('studio://editor/{browserId}/{resource}', {
    async list() {
      const tabs = await studio().listTargets();
      return {
        resources: tabs
          .filter((tab) => tab.ready)
          .flatMap(({ browserId }) =>
            EDITOR_RESOURCES.map((name) => ({
              uri: resourceUri(browserId, name),
              name,
              mimeType: MIME_TYPE,
              description: descriptions[name],
            })),
          ),
      };
    },
  });
  server.registerResource('editor', template, { mimeType: MIME_TYPE }, async (uri) => {
    const { browserId, resource } = parseAddress(uri.href);
    const value = await studio().call('readEditorResource', { resource }, browserId);
    return { contents: [{ uri: uri.href, mimeType: MIME_TYPE, text: JSON.stringify(value) }] };
  });
  if (!subscribe) return;

  const subscribed = new Set<string>();
  let watching: Promise<() => void> | undefined;
  function stopWatching() {
    void watching?.then((stop) => stop()).catch(() => {});
    watching = undefined;
  }
  server.server.setRequestHandler(SubscribeRequestSchema, async ({ params: { uri } }) => {
    const { browserId } = parseAddress(uri);
    const source = studio();
    if (!(await source.listTargets()).some((tab) => tab.ready && tab.browserId === browserId)) {
      throw new McpError(ErrorCode.InvalidParams, 'That editor tab is unavailable. List resources again.');
    }
    if (subscribed.size >= 128 && !subscribed.has(uri)) {
      throw new McpError(ErrorCode.InvalidParams, 'Unsubscribe from an editor resource before adding another.');
    }
    if (!source.watchEditor) throw new McpError(ErrorCode.InternalError, 'Editor subscriptions are unavailable.');
    subscribed.add(uri);
    watching ??= source
      .watchEditor(({ browserId, resources }) => {
        for (const resource of resources) {
          const changed = resourceUri(browserId, resource);
          if (subscribed.has(changed)) {
            void server.server
              .notification({ method: 'notifications/resources/updated', params: { uri: changed } })
              .catch(() => {});
          }
        }
      })
      .catch((error: unknown) => {
        watching = undefined;
        throw error;
      });
    try {
      await watching;
    } catch (error) {
      subscribed.delete(uri);
      throw error;
    }
    return {};
  });
  server.server.setRequestHandler(UnsubscribeRequestSchema, ({ params: { uri } }) => {
    subscribed.delete(uri);
    if (subscribed.size === 0) stopWatching();
    return {};
  });
  server.server.onclose = () => {
    subscribed.clear();
    stopWatching();
    studio().close();
  };
}
