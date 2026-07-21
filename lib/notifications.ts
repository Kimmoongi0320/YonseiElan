export type NotificationTemplate = {
  key: string;
  label: string;
  message: string;
};

// {name} is replaced per-recipient when the message is sent.
export const NOTIFICATION_TEMPLATES: NotificationTemplate[] = [
  { key: "arrival", label: "등원 안내", message: "{name} 학생이 학원에 등원하였습니다." },
  { key: "departure", label: "하원 안내", message: "{name} 학생이 학원에서 하원하였습니다." },
  {
    key: "absence",
    label: "결석 안내",
    message: "{name} 학생이 오늘 수업에 결석하였습니다. 확인 부탁드립니다.",
  },
  {
    key: "tuition",
    label: "원비 납부 안내",
    message: "{name} 학생의 이번 달 원비 납부 기한이 다가옵니다. 확인 부탁드립니다.",
  },
  { key: "custom", label: "직접 입력", message: "" },
];
