import { FetchError } from '@pnpm/error'

test('FetchError escapes auth tokens', () => {
  const error = new FetchError(
    { url: 'https://foo.com', authHeaderValue: 'Bearer 00000000000000000000' },
    { status: 401, statusText: 'Unauthorized' }
  )
  expect(error.message).toBe('GET https://foo.com: Unauthorized - 401')
  expect(error.hint).toBe('An authorization header was used: Bearer 0000[hidden]')
  expect(error.request.authHeaderValue).toBe('Bearer 0000[hidden]')
})

test('FetchError escapes short auth tokens', () => {
  const error = new FetchError(
    { url: 'https://foo.com', authHeaderValue: 'Bearer 0000000000' },
    { status: 401, statusText: 'Unauthorized' }
  )
  expect(error.message).toBe('GET https://foo.com: Unauthorized - 401')
  expect(error.hint).toBe('An authorization header was used: Bearer [hidden]')
  expect(error.request.authHeaderValue).toBe('Bearer [hidden]')
})

test('FetchError escapes non-standard auth header', () => {
  const error = new FetchError(
    { url: 'https://foo.com', authHeaderValue: '0000000000' },
    { status: 401, statusText: 'Unauthorized' }
  )
  expect(error.message).toBe('GET https://foo.com: Unauthorized - 401')
  expect(error.hint).toBe('An authorization header was used: [hidden]')
  expect(error.request.authHeaderValue).toBe('[hidden]')
})

test('FetchError includes server error message in hint for 403', () => {
  const serverMessage = 'In most cases, you or one of your dependencies are requesting a package version that is forbidden by your security policy'
  const error = new FetchError(
    { url: 'https://foo.com', authHeaderValue: 'Bearer 00000000000000000000' },
    { status: 403, statusText: 'Forbidden' },
    serverMessage
  )
  expect(error.message).toBe('GET https://foo.com: Forbidden - 403')
  expect(error.hint).toContain(serverMessage)
  expect(error.hint).toContain('An authorization header was used: Bearer 0000[hidden]')
  expect(error.hint).toMatch(new RegExp(`${serverMessage}\\n\\nAn authorization header was used:`))
})

test('FetchError includes server error message in hint for 403 without auth', () => {
  const serverMessage = 'Package is forbidden by security policy'
  const error = new FetchError(
    { url: 'https://foo.com' },
    { status: 403, statusText: 'Forbidden' },
    serverMessage
  )
  expect(error.message).toBe('GET https://foo.com: Forbidden - 403')
  expect(error.hint).toContain(serverMessage)
  expect(error.hint).toContain('No authorization header was set for the request.')
  expect(error.hint).toMatch(new RegExp(`${serverMessage}\\n\\nNo authorization header was set`))
})

test('FetchError works correctly for non-auth errors without hint', () => {
  const error = new FetchError(
    { url: 'https://foo.com' },
    { status: 500, statusText: 'Internal Server Error' }
  )
  expect(error.message).toBe('GET https://foo.com: Internal Server Error - 500')
  expect(error.hint).toBeUndefined()
})
