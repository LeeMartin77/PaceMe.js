import { Application, Request, Response } from 'express'
import { userRestrictedHandler } from '../utilities/UserRestrictedHandler'
import { createHash, randomBytes } from 'crypto'
import { Axios } from 'axios'
import { UserServiceTokenRepository } from '../repositories/userServiceTokenRepository'
import { ServiceCache } from '../caches/serviceCache'
import { CodeChallenceCache } from '../caches/codeChallengeCache'

const axios = new Axios({})

const FITBIT_SETTINGS = {
  clientId: process.env.FITBIT_CLIENT_ID ?? 'FitbitClientId',
  clientSecret: process.env.FITBIT_CLIENT_SECRET ?? 'FitbitClientSecret',
  authUrl: 'https://www.fitbit.com/oauth2/authorize',
  tokenUrl: 'https://api.fitbit.com/oauth2/token',
  rootApiUrl: 'https://api.fitbit.com',
  cacheExpiryMilliseconds: 300000
}

const SERVICE_KEY = 'fitbit'

interface IFitbitTokenResponse {
  // eslint-disable-next-line camelcase
  access_token: string,
  // eslint-disable-next-line camelcase
  expires_in: number,
  // eslint-disable-next-line camelcase
  refresh_token: string,
  scope: string,
  // eslint-disable-next-line camelcase
  token_type: string,
  // eslint-disable-next-line camelcase
  user_id: string
}

interface IFitbitTokenDetails extends IFitbitTokenResponse {
  // eslint-disable-next-line camelcase
  date_retrieved: string
}

const FITBIT_TOKEN_REPO = new UserServiceTokenRepository<IFitbitTokenDetails>(SERVICE_KEY)
const SERVICE_CACHE = new ServiceCache()
const CODE_CHALLENGE_CACHE = new CodeChallenceCache()

export function addFitbitHandlers (app: Application) {
  app.post('/users/:userId/providers/fitbit/start', (req, res) => userRestrictedHandler(req, res, startAuthenticationFlow))
  app.post('/users/:userId/providers/fitbit/redeem', (req, res) => userRestrictedHandler(req, res, redeemCode))
}

function startAuthenticationFlow (userId: string, req: Request, res: Response) {
  const CODE_VERIFIER = randomBytes(60).toString('hex')
  CODE_CHALLENGE_CACHE.SetCode(userId, CODE_VERIFIER)
  // Apparently fitbit wants - instead of +?
  // https://dev.fitbit.com/build/reference/web-api/developer-guide/authorization/
  const challengeHash = createHash('sha256').update(CODE_VERIFIER).digest('base64').replace('=', '').replace(/\+/g, '-')
  const authUrl = `https://www.fitbit.com/oauth2/authorize?client_id=${FITBIT_SETTINGS.clientId}&response_type=code` +
  `&code_challenge=${challengeHash}&code_challenge_method=S256` +
  '&scope=weight%20location%20settings%20profile%20nutrition%20activity%20sleep' +
  '%20heartrate%20social'
  return res.send({ authUrl })
}

async function redeemCode (userId: string, req: Request, res: Response) {
  const { code } = req.body
  const codeVerifier = CODE_CHALLENGE_CACHE.GetCode(userId)
  const tokenParameters = {
    client_id: FITBIT_SETTINGS.clientId,
    code: code,
    code_verifier: codeVerifier,
    grant_type: 'authorization_code'
  }
  const headers = {
    authorization: `Basic ${Buffer.from(`${FITBIT_SETTINGS.clientId}:${FITBIT_SETTINGS.clientSecret}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded'
  }
  // This is a bit trashy...
  const queryiedTokenUrl = FITBIT_SETTINGS.tokenUrl + '?' +
    `client_id=${tokenParameters.client_id}&` +
    `code=${tokenParameters.code}&` +
    `code_verifier=${tokenParameters.code_verifier}&` +
    `grant_type=${tokenParameters.grant_type}`
  const response = await axios.post(queryiedTokenUrl, '', { headers })
  if (response.status !== 200) { return res.send({ status: 'err' }).status(400) }
  const responseData: IFitbitTokenResponse = JSON.parse(response.data)
  const token: IFitbitTokenDetails = { ...responseData, date_retrieved: (new Date()).toISOString() }
  await FITBIT_TOKEN_REPO.updateUserToken(userId, token)
  res.send({ status: 'ok' })
}

export async function makeFitbitRequest<T> (userId: string, url: string): Promise<T> {
  const requestUrl = FITBIT_SETTINGS.rootApiUrl + url
  const cachedValue = await SERVICE_CACHE.GetResponse(userId, requestUrl)
  if (cachedValue && new Date(cachedValue.date).getTime() < ((new Date()).getTime() - FITBIT_SETTINGS.cacheExpiryMilliseconds)) {
    return JSON.parse(cachedValue.serialisedResponse) as T
  }
  const token = await getFitbitToken(userId)
  if (!token) { throw new Error('No Fitbit Token') }
  const fitbitResponse = await axios.get(requestUrl, {
    headers: {
      authorization: `Bearer ${token.access_token}`
    }
  })
  if (fitbitResponse.status !== 200) {
    console.error('ErrorStatusFromFitbit', fitbitResponse.status)
    console.error('ErrorStatusTextFromFitbit', fitbitResponse.statusText)
    console.error('ErrorResponseFromFitbit', fitbitResponse.data)
    throw new Error('Error from FitBit')
  }
  SERVICE_CACHE.SaveResponse(userId, requestUrl, fitbitResponse.data)
  return JSON.parse(fitbitResponse.data) as T
}

export async function getFitbitToken (userId: string): Promise<IFitbitTokenDetails | null> {
  const storedToken = await FITBIT_TOKEN_REPO.getUserToken(userId)
  if (!storedToken) {
    return null
  }
  if ((new Date()).getTime() > (Date.parse(storedToken.date_retrieved) + (storedToken.expires_in * 950))) {
    return await refreshedToken(userId, storedToken)
  }
  return storedToken
}

async function refreshedToken (userId: string, storedToken: IFitbitTokenDetails): Promise<IFitbitTokenDetails> {
  const tokenRequest = {
    client_id: FITBIT_SETTINGS.clientId,
    grant_type: 'refresh_token',
    refresh_token: storedToken.refresh_token
  }
  // This is a bit trashy...
  const queryiedTokenUrl = FITBIT_SETTINGS.tokenUrl + '?' +
    `client_id=${tokenRequest.client_id}&` +
    `refresh_token=${tokenRequest.refresh_token}&` +
    `grant_type=${tokenRequest.grant_type}`
  const response = await axios.post(queryiedTokenUrl, '', {
    headers: {
      authorization: `Basic ${Buffer.from(`${FITBIT_SETTINGS.clientId}:${FITBIT_SETTINGS.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    }
  })
  // TODO: need some proper erroring here...
  if (response.status !== 200) { return storedToken }
  const responseData: IFitbitTokenResponse = JSON.parse(response.data)
  const token: IFitbitTokenDetails = { ...responseData, date_retrieved: (new Date()).toISOString() }
  await FITBIT_TOKEN_REPO.updateUserToken(userId, token)
  return token
}
