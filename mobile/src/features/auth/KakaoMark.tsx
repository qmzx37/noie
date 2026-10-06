import React from "react";
import Svg, { Path } from "react-native-svg";

// 말풍선 마크만 표시합니다. 접근성 이름은 상위 로그인 버튼이 제공합니다.
export function KakaoMark() {
  return (
    <Svg width={26} height={26} viewBox="0 0 24 24" accessible={false}>
      <Path fill="#191919" d="M12 3C6.477 3 2 6.58 2 11c0 2.85 1.86 5.353 4.66 6.77l-.94 3.51c-.08.3.26.54.52.37l4.12-2.73c.54.05 1.09.08 1.64.08 5.523 0 10-3.58 10-8S17.523 3 12 3Z" />
    </Svg>
  );
}
