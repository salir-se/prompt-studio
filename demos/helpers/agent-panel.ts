import type { Page } from '@playwright/test';

/**
 * An on-screen panel that shows a scripted AI-agent session next to Prompt Studio. The panel is a
 * recording aid only: the tool calls it lists are real MCP calls the demo makes against the running
 * server, but the conversation text is scripted. The header says so on screen.
 */
export const PANEL_WIDTH = 600;

export async function mountAgentPanel(page: Page, title: string): Promise<void> {
  await page.evaluate(
    ({ width, title }) => {
      if (document.getElementById('demo-agent-panel')) return;
      const style = document.createElement('style');
      style.id = 'demo-agent-panel-style';
      style.textContent = `
        #root { position: fixed !important; inset: 0 0 0 ${width}px !important; overflow: hidden; }
        #demo-agent-panel { position: fixed; inset: 0 auto 0 0; width: ${width}px; z-index: 2147483000;
          background: #0b1020; color: #d7deea; display: flex; flex-direction: column;
          font: 15px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; border-right: 1px solid #1f2937; }
        #demo-agent-panel header { padding: 14px 18px; border-bottom: 1px solid #1f2937; display: flex; gap: 10px;
          align-items: center; font: 600 14px/1.2 system-ui, sans-serif; color: #e5e7eb; }
        #demo-agent-panel header .dot { width: 10px; height: 10px; border-radius: 50%; background: #10b981; }
        #demo-agent-panel header small { margin-left: auto; font-weight: 500; color: #94a3b8; }
        #demo-agent-log { flex: 1; overflow: hidden; padding: 16px 18px; display: flex; flex-direction: column;
          gap: 12px; justify-content: flex-end; }
        #demo-agent-log .you { color: #f8fafc; }
        #demo-agent-log .you::before { content: '› '; color: #38bdf8; }
        #demo-agent-log .agent { color: #cbd5e1; }
        #demo-agent-log .tool { color: #a7f3d0; font-size: 13px; padding: 6px 10px; border: 1px solid #134e4a;
          border-radius: 6px; background: #052e2b; }
        #demo-agent-log .tool b { color: #34d399; font-weight: 600; }
        #demo-agent-log .cmd { color: #fde68a; font-size: 13px; }
        #demo-agent-log .cmd::before { content: '$ '; color: #94a3b8; }
      `;
      document.head.append(style);
      const panel = document.createElement('aside');
      panel.id = 'demo-agent-panel';
      panel.setAttribute('aria-hidden', 'true');
      panel.innerHTML = `<header><span class="dot"></span><span></span><small>scripted session</small></header>
        <div id="demo-agent-log"></div>`;
      (panel.querySelector('header span:nth-child(2)') as HTMLElement).textContent = title;
      document.body.append(panel);
      window.dispatchEvent(new Event('resize'));
    },
    { width: PANEL_WIDTH, title },
  );
}

export type AgentLineKind = 'you' | 'agent' | 'tool' | 'cmd';

/** Appends one line; `you`/`agent`/`cmd` lines are typed character by character. */
export async function agentSay(page: Page, kind: AgentLineKind, text: string, charDelayMs = 18): Promise<void> {
  await page.evaluate(
    async ({ kind, text, charDelayMs }) => {
      const log = document.getElementById('demo-agent-log');
      if (!log) return;
      const line = document.createElement('div');
      line.className = kind;
      log.append(line);
      while (log.children.length > 14) log.firstElementChild?.remove();
      if (kind === 'tool') {
        const [name, ...rest] = text.split(' ');
        const bold = document.createElement('b');
        bold.textContent = name ?? '';
        line.append('⚙ ', bold, rest.length ? ` ${rest.join(' ')}` : '');
        return;
      }
      for (const character of text) {
        line.textContent += character;
        await new Promise((resolve) => setTimeout(resolve, charDelayMs));
      }
    },
    { kind, text, charDelayMs },
  );
}
