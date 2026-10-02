"""실제 OpenAI로 Daily Life routing과 multi-action을 평가합니다."""
import sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
from agent.orchestrator import orchestrate_with_openai

CASES=[
('exercise','오늘 헬스장에서 한 시간 운동했어.',True),
('development_emotion','오늘 NOIE 개발하고 기분도 좋았어.',True),
('future','내일 운동 갈 거야.',False),
('intention','운동해야겠다.',False),
('emotion_only','오늘 그냥 기분 좋아.',False),
('submitted','과제 제출 완료했어.',True),
('counterfactual','과제 제출했으면 좋았을 텐데.',False),
('friend_meal','오늘 친구 만나서 밥 먹었어.',True),
]
def run():
 for name,text,expected in CASES:
  result=orchestrate_with_openai(text); daily=[a for a in result.actions if a.type=='daily_life' and a.mode=='record']; actual=bool(daily)
  if actual!=expected:raise AssertionError(f'{name}: expected={expected}, actions={result.actions}')
  if daily and (daily[0].intent!='record_daily_trace' or not daily[0].arguments.summary.strip()):raise AssertionError(f'{name}: invalid payload {daily[0]}')
  if name=='development_emotion' and not any(a.type=='emotion' for a in result.actions):raise AssertionError('multi-action emotion missing')
  print(f'[PASS] {name}: daily={actual}, actions={[a.type for a in result.actions]}')
 print('SUMMARY=8/8')
if __name__=='__main__':run()
