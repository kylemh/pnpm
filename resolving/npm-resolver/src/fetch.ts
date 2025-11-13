import url from 'url'
import { requestRetryLogger } from '@pnpm/core-loggers'
import { globalWarn } from '@pnpm/logger'
import {
  FetchError,
  type FetchErrorRequest,
  type FetchErrorResponse,
  PnpmError,
} from '@pnpm/error'
import { type FetchFromRegistry, type RetryTimeoutOptions } from '@pnpm/fetching-types'
import { type PackageMeta } from '@pnpm/registry.types'
import * as retry from '@zkochan/retry'

interface RegistryResponse {
  status: number
  statusText: string
  json: () => Promise<PackageMeta>
}

// https://semver.org/#is-there-a-suggested-regular-expression-regex-to-check-a-semver-string
// eslint-disable-next-line regexp/no-super-linear-backtracking, regexp/use-ignore-case
const semverRegex = /(.*)(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/

export class RegistryResponseError extends FetchError {
  public readonly pkgName: string

  constructor (
    request: FetchErrorRequest,
    response: FetchErrorResponse,
    pkgName: string,
    serverHint?: string
  ) {
    let hint: string | undefined
    if (response.status === 404) {
      hint = `${pkgName} is not in the npm registry, or you have no permission to fetch it.`
      const matched = pkgName.match(semverRegex)
      if (matched != null) {
        hint += ` Did you mean ${matched[1]}?`
      }
    }
    // If there's a server hint, prepend it to any existing hint
    if (serverHint) {
      hint = hint ? `${serverHint}\n\n${hint}` : serverHint
    }
    super(request, response, hint)
    this.pkgName = pkgName
  }
}

export interface FetchMetadataFromFromRegistryOptions {
  fetch: FetchFromRegistry
  retry: RetryTimeoutOptions
  timeout: number
  fetchWarnTimeoutMs: number
}

export async function fetchMetadataFromFromRegistry (
  fetchOpts: FetchMetadataFromFromRegistryOptions,
  pkgName: string,
  registry: string,
  authHeaderValue?: string
): Promise<PackageMeta> {
  const uri = toUri(pkgName, registry)
  const op = retry.operation(fetchOpts.retry)
  return new Promise((resolve, reject) => {
    op.attempt(async (attempt) => {
      let response: RegistryResponse
      const startTime = Date.now()
      try {
        response = await fetchOpts.fetch(uri, {
          authHeaderValue,
          compress: true,
          retry: fetchOpts.retry,
          timeout: fetchOpts.timeout,
        }) as RegistryResponse
      } catch (error: any) { // eslint-disable-line
        reject(new PnpmError('META_FETCH_FAIL', `GET ${uri}: ${error.message as string}`, { attempts: attempt }))
        return
      }
      if (response.status > 400) {
        const request = {
          authHeaderValue,
          url: uri,
        }
        let serverHint: string | undefined
        // For auth-related errors, try to extract the error message from the response body
        if (response.status === 401 || response.status === 403 || response.status === 404) {
          try {
            const json = await response.json()
            if (json && typeof json === 'object') {
              if ('error' in json && typeof json.error === 'string') {
                serverHint = json.error
              } else if ('message' in json && typeof json.message === 'string') {
                serverHint = json.message
              }
            }
          } catch {
            // If we can't parse the JSON, just continue without a hint
          }
        }
        reject(new RegistryResponseError(request, response, pkgName, serverHint))
        return
      }

      // Here we only retry broken JSON responses.
      // Other HTTP issues are retried by the @pnpm/fetch library
      try {
        const json = await response.json()
        // Check if request took longer than expected
        const elapsedMs = Date.now() - startTime
        if (elapsedMs > fetchOpts.fetchWarnTimeoutMs) {
          globalWarn(`Request took ${elapsedMs}ms: ${uri}`)
        }
        resolve(json)
      } catch (error: any) { // eslint-disable-line
        const timeout = op.retry(
          new PnpmError('BROKEN_METADATA_JSON', error.message)
        )
        if (timeout === false) {
          reject(op.mainError())
          return
        }
        requestRetryLogger.debug({
          attempt,
          error,
          maxRetries: fetchOpts.retry.retries!,
          method: 'GET',
          timeout,
          url: uri,
        })
      }
    })
  })
}

function toUri (pkgName: string, registry: string): string {
  let encodedName: string

  if (pkgName[0] === '@') {
    encodedName = `@${encodeURIComponent(pkgName.slice(1))}`
  } else {
    encodedName = encodeURIComponent(pkgName)
  }

  return new url.URL(encodedName, registry.endsWith('/') ? registry : `${registry}/`).toString()
}
