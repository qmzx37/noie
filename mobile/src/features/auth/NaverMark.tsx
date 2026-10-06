import React from "react";
import Svg, { Path } from "react-native-svg";

// 흰색 N 마크만 그리며, 브랜드 배경과 접근성 이름은 상위 버튼에서 제공합니다.
export function NaverMark() {
  return (
    <Svg width={24} height={24} viewBox="0 0 24 24" accessible={false}>
      <Path fill="#ffffff" d="M16.27 3v9.63L7.73 3H3v18h4.73v-9.63L16.27 21H21V3z" />
    </Svg>
  );
}
