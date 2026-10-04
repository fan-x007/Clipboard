import * as https from 'https'
import { BalanceData } from '../tokenStore'

const PLATFORM_ID = 'zhipu'
const PLATFORM_NAME = '智谱AI'
const API_HOST = 'open.bigmodel.cn'
const API_PATH = '/api/biz/account/query-customer-account-report'

const adapter = {
  id: PLATFORM_ID,
  name: PLATFORM_NAME,
  description: '智谱AI开放平台（GLM 大模型）',
  website: 'https://open.bigmodel.cn/usercenter/apikeys',
  rechargeUrl: 'https://open.bigmodel.cn/finance-center/finance/pay',
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

            if (res.statusCode === 200 && result.success === true) {
              const dataObj = result.data || result

              const totalBalance = parseFloat(
                dataObj.total_available ||
                dataObj.availableBalance ||
                dataObj.balance ||
                dataObj.totalBalance ||
                dataObj.amount ||
                0
              )

              const cashBalance = parseFloat(
                dataObj.cash_balance ||
                dataObj.cashBalance ||
                dataObj.rechargeBalance ||
                0
              )

              const giftBalance = parseFloat(
                dataObj.gift_balance ||
                dataObj.giftBalance ||
                dataObj.grantedBalance ||
                dataObj.voucherBalance ||
                0
              )

              resolve({
                isAvailable: totalBalance > 0,
                currency: 'CNY',
                totalBalance,
                grantedBalance: giftBalance,
                toppedUpBalance: cashBalance,
              })
            } else if (res.statusCode === 401 || result.code === 401) {
              reject(new Error('API Key 无效，请检查您的 Key 是否正确'))
            } else {
              const errorMsg = result.msg || result.message || data
              reject(new Error(`请求失败 (${result.code || res.statusCode}): ${errorMsg}`))
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
