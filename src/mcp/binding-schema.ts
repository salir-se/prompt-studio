import { type } from 'arktype';
export const toolBindingsSchema = type({
  '+': 'reject',
  name: /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/,
  serverId: /^[a-f0-9-]{36}$/i,
  toolName: 'string > 0 & string <= 200',
  schemaHash: /^[a-f0-9]{64}$/,
  mode: "'mock' | 'real'",
  'mock?': 'string <= 32000',
})
  .array()
  .atMostLength(32);
