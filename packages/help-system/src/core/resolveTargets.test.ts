// @module-tag dom
import { afterEach, describe, expect, it } from 'vitest';
import { missingTargets, resolveTargets } from './resolveTargets';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('resolveTargets', () => {
  it('resolves visible elements by data-help-id, in request order and de-duped', () => {
    document.body.innerHTML = '<button data-help-id="a">A</button><div data-help-id="b">B</div>';
    const out = resolveTargets(['b', 'a', 'b']);
    expect(out.map((t) => t.helpId)).toEqual(['b', 'a']);
    expect(out[0].element.textContent).toBe('B');
  });

  it('skips missing ids', () => {
    document.body.innerHTML = '<div data-help-id="a"></div>';
    expect(resolveTargets(['nope'])).toHaveLength(0);
  });

  it('excludes hidden / display:none / disabled / aria-disabled elements', () => {
    document.body.innerHTML = [
      '<div data-help-id="vis"></div>',
      '<div data-help-id="hid" hidden></div>',
      '<div data-help-id="dn" style="display:none"></div>',
      '<button data-help-id="dis" disabled></button>',
      '<button data-help-id="adis" aria-disabled="true"></button>',
    ].join('');
    expect(resolveTargets(['vis', 'hid', 'dn', 'dis', 'adis']).map((t) => t.helpId)).toEqual(['vis']);
  });

  it('missingTargets reports requested ids that did not resolve', () => {
    document.body.innerHTML = '<div data-help-id="a"></div><div data-help-id="b" hidden></div>';
    expect(missingTargets(['a', 'b', 'c'])).toEqual(['b', 'c']);
  });
});
