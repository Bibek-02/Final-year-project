import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import StoreSelector from '../components/StoreSelector';
import client from '../api/client';

// Same automock approach as the rest of this project's tests: an inline
// mock factory with a jest.fn implementation silently drops the
// implementation under this Jest version (see Login.test.jsx for the
// full explanation) — automock + set-implementation-per-test instead.
jest.mock('../api/client');

beforeEach(() => {
  client.get.mockResolvedValue({ data: { store_ids: [1, 2, 3, 5, 42] } });
});

async function renderSelector({ selectedStore = 1, userRole, assignedStore, forecastType = 'weekly',
  setSelectedStore = () => {}, setForecastType = () => {} }) {
  render(
    <StoreSelector
      selectedStore={selectedStore}
      setSelectedStore={setSelectedStore}
      forecastType={forecastType}
      setForecastType={setForecastType}
      userRole={userRole}
      assignedStore={assignedStore}
    />
  );
  // Flush the mount-effect's store-list fetch inside act() so React doesn't
  // warn about a state update outside a tracked render.
  await act(async () => {});
}

test('shows a locked badge (not a combobox) for a manager, with no way to pick another store', async () => {
  await renderSelector({ selectedStore: 5, userRole: 'manager', assignedStore: 5 });

  expect(screen.getByText('Store 5')).toBeInTheDocument();
  expect(screen.getByText('Assigned store only')).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

test('renders a searchable combobox for an admin showing the selected store', async () => {
  await renderSelector({ selectedStore: 1, userRole: 'admin', assignedStore: null });

  const combobox = screen.getByRole('combobox');
  expect(combobox).toHaveValue('Store 1');
  expect(screen.queryByText('Assigned store only')).not.toBeInTheDocument();
});

test('typing in the combobox filters the store listbox', async () => {
  await renderSelector({ selectedStore: 1, userRole: 'admin', assignedStore: null });
  const combobox = screen.getByRole('combobox');

  fireEvent.change(combobox, { target: { value: '42' } });

  const listbox = screen.getByRole('listbox');
  const options = screen.getAllByRole('option');
  expect(options).toHaveLength(1);
  expect(options[0]).toHaveTextContent('Store 42');
  expect(listbox).toBeInTheDocument();
});

test('clicking a store option calls setSelectedStore with that store id', async () => {
  const setSelectedStore = jest.fn();
  await renderSelector({ selectedStore: 1, userRole: 'admin', assignedStore: null, setSelectedStore });
  const combobox = screen.getByRole('combobox');

  fireEvent.click(combobox);
  fireEvent.click(screen.getByRole('option', { name: 'Store 42' }));

  expect(setSelectedStore).toHaveBeenCalledWith(42);
});

test('keyboard navigation (arrow keys + Enter) selects a store in the combobox', async () => {
  const setSelectedStore = jest.fn();
  await renderSelector({ selectedStore: 1, userRole: 'admin', assignedStore: null, setSelectedStore });
  const combobox = screen.getByRole('combobox');

  combobox.focus();
  fireEvent.keyDown(combobox, { key: 'ArrowDown' }); // opens the list, highlights index 0 (store 1)
  fireEvent.keyDown(combobox, { key: 'ArrowDown' }); // highlight index 1 (store 2)
  fireEvent.keyDown(combobox, { key: 'Enter' });

  expect(setSelectedStore).toHaveBeenCalledWith(2);
});

test('the forecast-type control is an accessible radiogroup reflecting the current selection', async () => {
  await renderSelector({ forecastType: 'weekly', userRole: 'admin' });

  const weeklyRadio  = screen.getByRole('radio', { name: 'Weekly' });
  const monthlyRadio = screen.getByRole('radio', { name: 'Monthly' });
  expect(weeklyRadio).toHaveAttribute('aria-checked', 'true');
  expect(monthlyRadio).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('radiogroup')).toBeInTheDocument();
});

test('clicking Monthly calls setForecastType', async () => {
  const setForecastType = jest.fn();
  await renderSelector({ forecastType: 'weekly', userRole: 'admin', setForecastType });

  fireEvent.click(screen.getByRole('radio', { name: 'Monthly' }));

  expect(setForecastType).toHaveBeenCalledWith('monthly');
});

test('arrow-right on the segmented control switches to Monthly', async () => {
  const setForecastType = jest.fn();
  await renderSelector({ forecastType: 'weekly', userRole: 'admin', setForecastType });

  const weeklyRadio = screen.getByRole('radio', { name: 'Weekly' });
  weeklyRadio.focus();
  fireEvent.keyDown(weeklyRadio.closest('[role="radiogroup"]'), { key: 'ArrowRight' });

  expect(setForecastType).toHaveBeenCalledWith('monthly');
});
