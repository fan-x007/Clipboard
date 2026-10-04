import * as https from 'https'
import { BalanceData } from '../tokenStore'

const PLATFORM_ID = 'deepseek'
const PLATFORM_NAME = 'DeepSeek'
const API_HOST = 'api.deepseek.com'
const API_PATH = '/user/balance'

const adapter = {
  id: PLATFORM_ID,
  name: PLATFORM_NAME,
  description: 'DeepSeek 开放平台',
  website: 'https://platform.deepseek.com/api_keys',
  rechargeUrl: 'https://platform.deepseek.com/topup',
  currency: 'CNY',
  credentialType: 'api_key',
  credentialHint: '',
  isTokenQuota: false,

  getBalance(apiKey: string): Promise<BalanceData> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: API_HOST,
        path: API_PATH,
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        timeout: 10000,
      }

      const req = https.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          try {
            const result = JSON.parse(data)

            if (res.statusCode === 200 && result.is_available !== undefined) {
              const balanceInfo = result.balance_infos && result.balance_infos[0]
                ? result.balance_infos[0]
                : { currency: 'CNY', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }

              resolve({
                isAvailable: result.is_available === true || result.is_available === 'true',
                currency: balanceInfo.currency || 'CNY',
                totalBalance: parseFloat(balanceInfo.total_balance || 0),
                grantedBalance: parseFloat(balanceInfo.granted_balance || 0),
                toppedUpBalance: parseFloat(balanceInfo.topped_up_balance || 0),
              })
            } else if (res.statusCode === 401) {
              reject(new Error('API Key 无效，请检查您的 Key 是否正确'))
            } else {
              const errorMsg = result.error?.message || result.message || data
              reject(new Error(`请求失败 (${res.statusCode}): ${errorMsg}`))
            }
          } catch (e) {
            reject(new Error(`解析响应失败: ${(e as Error).message}`))
          }
        })
      })

      req.on('error', (e) => {
        reject(new Error(`网络错误: ${e.message}`))
      })

      req.on('timeout', () => {
        req.destroy()
        reject(new Error('请求超时，请检查网络连接'))
      })

      req.end()
    })
  },
}

export default adapter
