"""Emotion과 Daily Life multi-action의 실제 DB 독립성을 검증합니다."""
import sys
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import func, select
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
import main
from agent.orchestrator import orchestrate_with_openai
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction,ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.emotion_event import EmotionEvent
from models.message import Message
from models.user import User

def seed(db,user,conversation,message,tool,args,order):
 a=AgentAction(user_id=user,conversation_id=conversation,message_id=message,action_id=uuid4(),tool_name=tool,action_type='emotion' if tool=='record_emotion' else 'daily_life',intent=tool,mode='record',status='ready',confidence=.9,requires_confirmation=False,execution_order=order,idempotency_key=uuid4().hex,confirmation_status='not_required',attempt_count=0,arguments=args,metadata_={});db.add(a);db.flush();return a.action_id
def run():
 rid=uuid4().hex
 with SessionLocal() as db:
  u=User(name=f'__multi_daily__{rid}',metadata_={});db.add(u);db.flush();c=Conversation(user_id=u.id,title=rid,metadata_={});db.add(c);db.flush();m=Message(conversation_id=c.id,user_id=u.id,role='user',content='오늘 운동했고 기분도 좋아.',metadata_={});db.add(m);db.commit();uid,cid,mid=u.id,c.id,m.id
 client=TestClient(main.app);result=orchestrate_with_openai('오늘 운동했고 기분도 좋아.');actions=[a for a in result.actions if a.type in {'emotion','daily_life'}]
 if {a.type for a in actions}!={'emotion','daily_life'}:raise AssertionError(result)
 plans=create_tool_plan(ToolPlanRequest(actions=[GatewayAction.model_validate(a.model_dump()) for a in actions])).plans
 saved=client.post('/agent/actions/plan',json={'user_id':str(uid),'conversation_id':str(cid),'message_id':str(mid),'plans':[p.model_dump(mode='json') for p in plans]})
 for p in plans:
  r=client.post(f'/agent/actions/{p.action_id}/execute',json={'user_id':str(uid)});assert r.status_code==200 and r.json()['action']['status']=='completed',r.text
 with SessionLocal() as db:
  ec=db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.message_id==mid));dc=db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.message_id==mid))
 assert ec==1 and dc==1 and len({p.action_id for p in plans})==2
 print('[PASS] A Emotion 성공 + Daily 성공; event=1/1, action_id 분리')
 with SessionLocal() as db:
  m2=Message(conversation_id=cid,user_id=uid,role='user',content='독립성 B',metadata_={});m3=Message(conversation_id=cid,user_id=uid,role='user',content='독립성 C',metadata_={});db.add_all([m2,m3]);db.flush()
  e_ok=seed(db,uid,cid,m2.id,'record_emotion',{'F':0,'A':0,'D':0,'J':.8,'C':.1,'G':.1,'T':0,'R':.6,'confidence':.9},1);d_bad=seed(db,uid,cid,m2.id,'record_daily_trace',{'summary':''},2)
  d_ok=seed(db,uid,cid,m3.id,'record_daily_trace',{'summary':'운동 완료','category':'activity'},1);e_bad=seed(db,uid,cid,m3.id,'record_emotion',{'F':2},2);db.commit();m2id,m3id=m2.id,m3.id
 for aid in [e_ok,d_bad,d_ok,e_bad]:client.post(f'/agent/actions/{aid}/execute',json={'user_id':str(uid)})
 with SessionLocal() as db:
  b_e=db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.message_id==m2id));b_d=db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.message_id==m2id));c_e=db.scalar(select(func.count(EmotionEvent.id)).where(EmotionEvent.message_id==m3id));c_d=db.scalar(select(func.count(DailyLifeEvent.id)).where(DailyLifeEvent.message_id==m3id))
 assert (b_e,b_d)==(1,0);print('[PASS] B Emotion 성공 + Daily 실패 독립')
 assert (c_e,c_d)==(0,1);print('[PASS] C Daily 성공 + Emotion 실패 독립')
 print('SUMMARY=3/3')
if __name__=='__main__':run()
