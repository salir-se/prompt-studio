// @module-tag pure
import { Type, type } from 'arktype';
import { describe, expect, it, vi } from 'vitest';
import { lazyType } from './lazy-type';

describe('lazyType', () => {
  it('builds the schema once, on first use, not at module load', () => {
    // Given: a schema declared lazily
    const build = vi.fn(() => type({ id: 'string', 'count?': 'number' }));
    const Item = lazyType(build);

    // Then: declaring it ran nothing
    expect(build).not.toHaveBeenCalled();

    // When: it is used twice
    const first = Item({ id: 'a' });
    const second = Item({ id: 'b', count: 1 });

    // Then: it was built exactly once and validates like the real Type
    expect(build).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ id: 'a' });
    expect(second).toEqual({ id: 'b', count: 1 });
    expect(Item({ id: 1 })).toBeInstanceOf(type.errors);
  });

  it('behaves as the real Type when embedded, composed and introspected', () => {
    // Given: a lazy schema and a schema that embeds it before it was ever used
    const Item = lazyType(() => type({ id: 'string' }));
    const Order = type({ item: Item, items: Item.array() });

    // Then: embedding, composition, instanceof and introspection reach the real Type
    expect(Order.allows({ item: { id: 'a' }, items: [{ id: 'b' }] })).toBe(true);
    expect(Order.allows({ item: { id: 1 }, items: [] })).toBe(false);
    expect(Item.or('null').allows(null)).toBe(true);
    expect(Item.pipe((value) => value.id)({ id: 'z' })).toBe('z');
    expect(Item).toBeInstanceOf(Type);
    expect(Item.expression).toBe('{ id: string }');
    expect(Item.toJsonSchema()).toMatchObject({ type: 'object', required: ['id'] });
    expect('allows' in Item).toBe(true);
    // And: a nested Type reached through a property keeps its own methods (it is not a plain function to bind)
    expect(Item.in.allows({ id: 'a' })).toBe(true);
    expect(Item.get('id').allows('a')).toBe(true);
    // And: the inferred type is the real one
    const value: typeof Item.infer = { id: 'typed' };
    expect(value.id).toBe('typed');
  });

  it('hands out one bound method per name, so a hot path allocates nothing per call', () => {
    // Given: a lazy schema
    const Item = lazyType(() => type({ id: 'string' }));

    // When: the same method is read twice
    // Then: it is the same function, bound to the real Type
    expect(Item.allows).toBe(Item.allows);
    expect(Item.allows({ id: 'a' })).toBe(true);
  });
});
