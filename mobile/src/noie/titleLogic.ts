export type NoieTitleContext =
  | "chat"
  | "routine"
  | "project"
  | "dream"
  | "dream_fragment"
  | "daily_trace"
  | "daily_piece"
  | "completed_action";

const MAX_TITLE_LENGTH = 18;

// Automatic title helper only. Do not apply this to titles the user typed or renamed manually.
export function makeSmartTitle(text: string, context: NoieTitleContext): string {
  const normalizedText = normalizeTitleText(text);
  const baseTitle = buildContextTitle(normalizedText, context) || normalizedText || "새 제목";
  return limitTitleLength(cleanTitleSpacing(baseTitle));
}

function buildContextTitle(text: string, context: NoieTitleContext) {
  switch (context) {
    case "routine":
      return makeRoutineTitle(text);
    case "project":
      return makeProjectTitle(text);
    case "dream":
    case "dream_fragment":
      return makeDreamTitle(text);
    case "completed_action":
      return makeCompletedActionTitle(text);
    case "daily_trace":
    case "daily_piece":
      return makeDailyTraceTitle(text);
    case "chat":
    default:
      return removeConversationTail(text);
  }
}

function normalizeTitleText(text: string) {
  return cleanTitleSpacing(
    text
      .replace(/[“”"']/g, "")
      .replace(/[.!?。！？]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

function makeRoutineTitle(text: string) {
  const title = removeConversationTail(removeAmountExpressions(removeRoutinePrefix(text)))
    .replace(/(?:으로|로)$/g, "")
    .replace(/씩$/g, "")
    .replace(/하기$/g, "")
    .trim();

  if (!title) {
    return "";
  }

  if (isBareRoutineTitle(title)) {
    return title;
  }

  return title.endsWith("하기") ? title : `${title}하기`;
}

function makeProjectTitle(text: string) {
  return removeConversationTail(text)
    .replace(/프로젝트(?:를|을)?\s*시작(?:할래|하고 싶어|하려고 해)?/g, "")
    .replace(/(?:를|을)?\s*(?:시작할래|시작하고 싶어|시작하려고 해)$/g, "")
    .replace(/만들기$/g, "")
    .trim();
}

function makeDreamTitle(text: string) {
  const title = removeConversationTail(text)
    .replace(/^(?:내\s*)?꿈은\s*/g, "")
    .replace(/(?:이|가)?\s*되는\s*(?:게|거|것)?\s*(?:내\s*)?꿈(?:이야|입니다|이에요)?$/g, " 되기")
    .replace(/(?:이|가)?\s*되고\s*싶어(?:요)?$/g, " 되기")
    .replace(/(?:를|을)?\s*꿈꾸고\s*있어(?:요)?$/g, "")
    .trim();

  return title;
}

function makeCompletedActionTitle(text: string) {
  return removeAmountExpressions(
    text
      .replace(/^(?:오늘|방금|아까)\s*/g, "")
      .replace(/(?:를|을)?\s*(?:수정하고\s*테스트까지\s*끝냈어|수정했어|완료했어|완료했어요|끝냈어|끝냈어요|했어|했어요)$/g, " 수정")
      .replace(/\s*까지\s*/g, " ")
  ).trim();
}

function makeDailyTraceTitle(text: string) {
  return removeConversationTail(removeAmountExpressions(text))
    .replace(/^(?:오늘|방금|아까)\s*/g, "")
    .replace(/(?:를|을)?\s*(?:남겨줘|기록해줘|저장해줘)$/g, "")
    .replace(/(?:수정하고\s*테스트까지\s*끝냈어|수정했어|완료했어|끝냈어)$/g, "수정")
    .trim();
}

function removeRoutinePrefix(text: string) {
  return text
    .replace(/^(?:매일|매주|평일마다|주말마다|오늘의 나에|오늘)\s*/g, "")
    .replace(/반복\s*목표/g, "")
    .trim();
}

function removeAmountExpressions(text: string) {
  return text
    .replace(/\d+(?:\.\d+)?\s*(?:시간|분|회|개|페이지|세트)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function removeConversationTail(text: string) {
  return text
    .replace(/(?:으로|로)?\s*(?:하고 싶어|하고 싶어요|하려고 해|하려고 해요|할래|할래요|꾸준히 할래|매일 할래|이어가고 싶어)$/g, "")
    .replace(/(?:을|를)?\s*(?:추가해줘|넣어줘|만들어줘|저장해줘|남겨줘|기록해줘)$/g, "")
    .replace(/(?:을|를)?\s*(?:완료했어|완료했어요|수행했어|수행했어요|끝냈어|끝냈어요)$/g, "")
    .trim();
}

function isBareRoutineTitle(title: string) {
  return /(?:운동|스트레칭|공부|명상|산책|러닝|요가)$/.test(title);
}

function cleanTitleSpacing(text: string) {
  return text
    .replace(/([A-Za-z]+)([가-힣]+)/g, "$1 $2")
    .replace(/([가-힣])([A-Za-z]+)/g, "$1 $2")
    .replace(/(코딩)(작업)/g, "$1 $2")
    .replace(/(로그인)(오류)/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function limitTitleLength(title: string) {
  if (title.length <= MAX_TITLE_LENGTH) {
    return title;
  }

  const words = title.split(/\s+/);
  let nextTitle = "";
  for (const word of words) {
    const candidate = nextTitle ? `${nextTitle} ${word}` : word;
    if (candidate.length > MAX_TITLE_LENGTH) {
      break;
    }
    nextTitle = candidate;
  }

  return nextTitle || title.slice(0, MAX_TITLE_LENGTH);
}
