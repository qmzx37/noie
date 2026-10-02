"""record_daily_trace를 실제 PostgreSQL에서 검증합니다."""
import sys, threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import func, select

ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path: sys.path.insert(0,str(ROOT))
import main
from agent.executor_registry import register_executor
from agent.executor_service import _acquire_lease
from agent.record_daily_trace_executor import record_daily_trace_executor
from agent.tool_gateway import create_tool_plan
from agent.tool_schemas import GatewayAction,ToolPlanRequest
from database import SessionLocal
from models.agent_action import AgentAction
from models.conversation import Conversation
from models.daily_life_event import DailyLifeEvent
from models.emotion_event import EmotionEvent
from models.message import Message
from models.user import User

RID=uuid4().hex; PASS=0
def ok(n,c,d=""):
 global PASS
 if not c: raise AssertionError(f"{n}: {d}")
 PASS+=1; print(f"[PASS] {n}: {d}")
def plan(summary="헬스장에서 한 시간 운동함"):
 a=GatewayAction(type="daily_life",intent="record_daily_trace",mode="record",reason="완료 행동",confidence=.9,requires_confirmation=False,execution_order=1,arguments={"summary":summary,"category":"activity"})
 return create_tool_plan(ToolPlanRequest(actions=[a])).plans[0]
def save(client,u,c,m,p):
 return client.post('/agent/actions/plan',json={"user_id":str(u),"conversation_id":str(c),"message_id":str(m),"plans":[p.model_dump(mode='json')]})
def exe(client,a,u): return client.post(f'/agent/actions/{a}/execute',json={"user_id":str(u)})
def rows(action_id):
 with SessionLocal() as db:
  a=db.scalar(select(AgentAction).where(AgentAction.action_id==action_id)); es=db.scalars(select(DailyLifeEvent).where(DailyLifeEvent.agent_action_id==a.id)).all(); return a,es
def fail(): raise RuntimeError('injected')

def run():
 global PASS
 with SessionLocal() as db:
  u=User(name=f'__daily_test__{RID}',metadata_={"test":RID}); o=User(name=f'__daily_other__{RID}',metadata_={"test":RID}); db.add_all([u,o]);db.flush()
  c=Conversation(user_id=u.id,title=RID,metadata_={}); oc=Conversation(user_id=o.id,title=RID,metadata_={});db.add_all([c,oc]);db.flush()
  ms=[Message(conversation_id=c.id,user_id=u.id,role='user',content=f'완료 행동 {i}',metadata_={}) for i in range(7)]; om=Message(conversation_id=oc.id,user_id=o.id,role='user',content='other',metadata_={});db.add_all(ms+[om]);db.commit(); uid,oid,cid=u.id,o.id,c.id; mids=[m.id for m in ms]; omid=om.id
 client=TestClient(main.app); emotion_before=0
 with SessionLocal() as db: emotion_before=db.scalar(select(func.count(EmotionEvent.id)))
 p=plan(); s=save(client,uid,cid,mids[0],p); x=exe(client,p.action_id,uid); a,es=rows(p.action_id)
 ok('1 completed',s.status_code==201 and x.json()['action']['status']=='completed'); ok('2 row 생성',len(es)==1); e=es[0]
 ok('3 summary',e.summary=='헬스장에서 한 시간 운동함');ok('4 user',e.user_id==uid);ok('5 conversation',e.conversation_id==cid);ok('6 message',e.message_id==mids[0]);ok('7 action',e.agent_action_id==a.id)
 again=exe(client,p.action_id,uid);ok('8 중복 없음',len(rows(p.action_id)[1])==1);ok('9 completed 재사용',again.json()['executor_called'] is False)
 p2=plan('과제 제출 완료');save(client,uid,cid,mids[1],p2);responses=[];bar=threading.Barrier(2)
 def go(): bar.wait();responses.append(exe(TestClient(main.app),p2.action_id,uid))
 ts=[threading.Thread(target=go) for _ in range(2)];[t.start() for t in ts];[t.join() for t in ts];ok('10 동시 1건',len(rows(p2.action_id)[1])==1 and sorted(r.status_code for r in responses)==[200,409])
 p3=plan();sv=save(client,uid,cid,mids[2],p3).json()[0];ok('11 타 사용자 실행 차단',exe(client,sv['action_id'],oid).status_code==404)
 ok('12 타 사용자 message 차단',save(client,uid,cid,omid,plan()).status_code==400);ok('13 없는 message 차단',save(client,uid,cid,uuid4(),plan()).status_code==400)
 register_executor('record_daily_trace',lambda ctx:record_daily_trace_executor(ctx,before_insert=fail));pa=plan();save(client,uid,cid,mids[3],pa);ra=exe(client,pa.action_id,uid);ok('14 insert 실패',ra.json()['action']['status']=='failed' and len(rows(pa.action_id)[1])==0)
 register_executor('record_daily_trace',lambda ctx:record_daily_trace_executor(ctx,before_commit=fail));pb=plan();save(client,uid,cid,mids[4],pb);rb=exe(client,pb.action_id,uid);ok('15 commit rollback',rb.json()['action']['status']=='failed' and len(rows(pb.action_id)[1])==0)
 register_executor('record_daily_trace',record_daily_trace_executor);pc=plan();save(client,uid,cid,mids[5],pc);_,lease=_acquire_lease(pc.action_id,uid);ctx=type('C',(),{'action_id':str(lease.action_id),'user_id':str(uid),'tool_name':lease.tool_name,'attempt_count':lease.attempt_count})();first=record_daily_trace_executor(ctx)
 with SessionLocal() as db: aa=db.scalar(select(AgentAction).where(AgentAction.action_id==pc.action_id));aa.lease_expires_at=datetime.now(timezone.utc)-timedelta(seconds=1);db.commit()
 retry=exe(client,pc.action_id,uid);ok('16 finalize 재사용',first.data['recorded'] and retry.json()['action']['result']['data']['recorded'] is False and len(rows(pc.action_id)[1])==1)
 restart=exe(TestClient(main.app),p.action_id,uid);ok('17 재시작 중복 없음',restart.json()['executor_called'] is False and len(rows(p.action_id)[1])==1)
 with SessionLocal() as db: emotion_after=db.scalar(select(func.count(EmotionEvent.id)))
 ok('18 emotion 독립',emotion_before==emotion_after);ok('19 source/version',e.source=='orchestrator' and e.metadata_['extractor_version']=='daily-life-v1');ok('20 기존 action 보존',a.status=='completed')
 print(f'TEST_USER_ID={uid}');print(f'SUMMARY={PASS}/20')
if __name__=='__main__':run()
