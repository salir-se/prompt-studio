// @module-tag dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { RunSetupFields } from './RunSetupFields';
import { RUN_SETTINGS, RUN_SETUP } from './run-fixtures';

afterEach(cleanup);
it('#2490: shows inherited model and discovered skill checkboxes without opening another panel', () => {
  const onChange = vi.fn();
  render(
    <RunSetupFields setup={RUN_SETUP} settings={RUN_SETTINGS} connected onChange={onChange} onSettings={vi.fn()} />,
  );
  expect(screen.queryByRole('textbox', { name: 'Model' })).not.toBeInTheDocument();
  expect(screen.queryByRole('combobox', { name: 'Provider' })).not.toBeInTheDocument();
  expect(screen.getByText('configured-model')).toBeVisible();
  fireEvent.click(screen.getByText(/Edit skill attachments/));
  const skill = screen.getByRole('checkbox', { name: /Clear writing/ });
  expect(skill).toBeVisible();
  fireEvent.click(skill);
  expect(onChange).toHaveBeenCalledWith({ ...RUN_SETUP, skills: ['research', 'writing'] });
});

it('summarizes optional attachments and retains search when collapsing their editor', () => {
  render(
    <RunSetupFields setup={RUN_SETUP} settings={RUN_SETTINGS} connected onChange={vi.fn()} onSettings={vi.fn()} />,
  );
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  const disclosure = screen.getByText(/Edit skill attachments/);
  fireEvent.click(disclosure);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'writing' } });
  fireEvent.click(disclosure);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  fireEvent.click(disclosure);
  expect(screen.getByRole('searchbox')).toHaveValue('writing');
});
