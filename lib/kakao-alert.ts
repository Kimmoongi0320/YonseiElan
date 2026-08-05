import { SolapiMessageService } from "solapi";

/**
 * Server-only Solapi client. Never import this from a "use client" component —
 * the API secret must not reach the browser bundle.
 */
let client: SolapiMessageService | null = null;

function getMessageService(): SolapiMessageService {
  if (client) return client;

  const apiKey = process.env.SOLAPI_API_KEY;
  const apiSecret = process.env.SOLAPI_API_SECRET;

  if (!apiKey || !apiSecret) {
    throw new Error(
      "Missing Solapi environment variables: SOLAPI_API_KEY and SOLAPI_API_SECRET must be set."
    );
  }

  client = new SolapiMessageService(apiKey, apiSecret);
  return client;
}

export type KakaoAlertParams = {
  /** 01012345678 형식의 수신번호 */
  to: string;
  /** 01012345678 형식의 발신번호 (Solapi 계정에 등록된 번호) */
  from: string;
  /** 연동한 비즈니스 채널의 pfId */
  pfId: string;
  /** 등록한 알림톡 템플릿의 ID */
  templateId: string;
  /** 템플릿 치환문구. key, value 모두 string이어야 합니다. */
  variables?: Record<string, string>;
  /** true로 주면 알림톡 발송 실패 시 문자 대체발송을 비활성화합니다. */
  disableSms?: boolean;
};

export async function sendKakaoAlert({
  to,
  from,
  pfId,
  templateId,
  variables = {},
  disableSms,
}: KakaoAlertParams) {
  return getMessageService().send({
    to,
    from,
    kakaoOptions: {
      pfId,
      templateId,
      variables,
      ...(disableSms !== undefined ? { disableSms } : {}),
    },
  });
}
