import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import Sidebar from '../components/Sidebar';
import { ThemeProvider } from '../context/ThemeContext';

const noop = () => {};

function renderSidebar(role) {
  render(
    <ThemeProvider>
      <Sidebar
        activePage="dashboard"
        setActivePage={noop}
        onLogout={noop}
        user={{ username: 'test', role }}
        forecastType="weekly"
      />
    </ThemeProvider>
  );
}

test('hides the Users link for a manager', () => {
  renderSidebar('manager');
  expect(screen.queryByText('Users')).not.toBeInTheDocument();
});

test('shows the Users link for an admin', () => {
  renderSidebar('admin');
  expect(screen.getByText('Users')).toBeInTheDocument();
});

test('shows the AI Recommendations link regardless of role', () => {
  renderSidebar('manager');
  expect(screen.getByText('AI Recommendations')).toBeInTheDocument();
});

test('groups links under section captions', () => {
  renderSidebar('admin');
  expect(screen.getByText('Overview')).toBeInTheDocument();
  expect(screen.getByText('Analysis')).toBeInTheDocument();
  expect(screen.getByText('Decide')).toBeInTheDocument();
  expect(screen.getByText('Evidence')).toBeInTheDocument();
  expect(screen.getByText('Admin')).toBeInTheDocument();
});

test('renders a single Explanation link and no separate Business Interpretation link', () => {
  renderSidebar('admin');
  expect(screen.getByText('Explanation')).toBeInTheDocument();
  expect(screen.queryByText('Business Interpretation')).not.toBeInTheDocument();
});
