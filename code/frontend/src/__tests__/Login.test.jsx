import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import Login from '../pages/auth/Login';
import client from '../api/client';

// Same automock approach as StoreSelector.test.jsx: an inline mock factory
// with a jest.fn implementation silently drops the implementation on this
// project's Jest version, so automock + set-implementation-per-test is used
// instead.
jest.mock('../api/client');

function renderLogin(onLogin = () => {}) {
  render(<Login onLogin={onLogin} />);
  return {
    usernameInput: screen.getByLabelText('Username'),
    passwordInput: screen.getByLabelText('Password'),
    submitButton: screen.getByRole('button', { name: /open dashboard|signing in/i }),
    toggleButton: screen.getByRole('button', { name: /show password|hide password/i }),
  };
}

beforeEach(() => {
  sessionStorage.clear();
  jest.clearAllMocks();
});

test('shows separate required-field messages on empty submission', () => {
  const { submitButton } = renderLogin();

  fireEvent.click(submitButton);

  expect(screen.getByText('Username is required.')).toBeInTheDocument();
  expect(screen.getByText('Password is required.')).toBeInTheDocument();
});

test('does not call client.post on empty submission', () => {
  const { submitButton } = renderLogin();

  fireEvent.click(submitButton);

  expect(client.post).not.toHaveBeenCalled();
});

test('password visibility control toggles the input type', () => {
  const { passwordInput, toggleButton } = renderLogin();

  expect(passwordInput).toHaveAttribute('type', 'password');

  fireEvent.click(toggleButton);
  expect(passwordInput).toHaveAttribute('type', 'text');

  fireEvent.click(toggleButton);
  expect(passwordInput).toHaveAttribute('type', 'password');
});

test('password visibility button is keyboard accessible', () => {
  const { toggleButton } = renderLogin();

  expect(toggleButton).not.toHaveAttribute('tabindex', '-1');
  expect(toggleButton).toHaveAttribute('type', 'button');

  toggleButton.focus();
  expect(toggleButton).toHaveFocus();
});

test('successful login posts to /auth/login', async () => {
  client.post.mockResolvedValue({
    data: { access_token: 'tok-123', username: 'testuser', role: 'manager', assigned_store: 5 },
  });
  const { usernameInput, passwordInput, submitButton } = renderLogin();

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'secret123' } });
  await act(async () => { fireEvent.click(submitButton); });

  expect(client.post).toHaveBeenCalledWith('/auth/login', expect.anything(), expect.objectContaining({
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }));
  expect(client.post.mock.calls[0][0]).toBe('/auth/login');
});

test('sends the credentials as a URLSearchParams body', async () => {
  client.post.mockResolvedValue({
    data: { access_token: 'tok-123', username: 'testuser', role: 'manager', assigned_store: 5 },
  });
  const { usernameInput, passwordInput, submitButton } = renderLogin();

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'secret123' } });
  await act(async () => { fireEvent.click(submitButton); });

  const body = client.post.mock.calls[0][1];
  expect(body).toBeInstanceOf(URLSearchParams);
  expect(body.get('username')).toBe('testuser');
  expect(body.get('password')).toBe('secret123');
});

test('stores the access token in sessionStorage on success', async () => {
  client.post.mockResolvedValue({
    data: { access_token: 'tok-123', username: 'testuser', role: 'manager', assigned_store: 5 },
  });
  const { usernameInput, passwordInput, submitButton } = renderLogin();

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'secret123' } });
  await act(async () => { fireEvent.click(submitButton); });

  expect(sessionStorage.getItem('token')).toBe('tok-123');
});

test('calls onLogin with token, username, role and assigned_store on success', async () => {
  client.post.mockResolvedValue({
    data: { access_token: 'tok-123', username: 'testuser', role: 'manager', assigned_store: 5 },
  });
  const onLogin = jest.fn();
  const { usernameInput, passwordInput, submitButton } = renderLogin(onLogin);

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'secret123' } });
  await act(async () => { fireEvent.click(submitButton); });

  expect(onLogin).toHaveBeenCalledWith({
    token: 'tok-123',
    username: 'testuser',
    role: 'manager',
    assigned_store: 5,
  });
});

test('displays the backend error message for invalid credentials', async () => {
  client.post.mockRejectedValue({
    response: { data: { detail: 'Incorrect username or password' } },
  });
  const { usernameInput, passwordInput, submitButton } = renderLogin();

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'wrongpass' } });
  await act(async () => { fireEvent.click(submitButton); });

  expect(await screen.findByText('Incorrect username or password')).toBeInTheDocument();
});

test('disables the submit button and shows "Signing in…" while the request is pending', async () => {
  let resolvePost;
  client.post.mockImplementation(() => new Promise(resolve => { resolvePost = resolve; }));
  const { usernameInput, passwordInput, submitButton } = renderLogin();

  fireEvent.change(usernameInput, { target: { value: 'testuser' } });
  fireEvent.change(passwordInput, { target: { value: 'secret123' } });
  fireEvent.click(submitButton);

  await waitFor(() => expect(submitButton).toBeDisabled());
  expect(screen.getByText('Signing in…')).toBeInTheDocument();

  await act(async () => {
    resolvePost({
      data: { access_token: 'tok-123', username: 'testuser', role: 'manager', assigned_store: 5 },
    });
  });
});
