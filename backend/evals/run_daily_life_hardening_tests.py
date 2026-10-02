"""Daily Life read API와 metadata를 실제 PostgreSQL에서 검증합니다."""
import sys
from datetime import datetime,timezone
from pathlib import Path
from uuid import uuid4
from fastapi.testclient import TestClient
from sqlalchemy import select
ROOT=Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:sys.path.insert(0,str(ROOT))
import main
from database import SessionLocal
from models.agent_action import AgentAction
from models.daily_life_event import DailyLifeEvent
from models.user import User

def run():
 rid=uuid4().hex;now=datetime.now(timezone.utc)
 with SessionLocal() as db:
  u=User(name=f'__daily_hardening__{rid}',metadata_={});o=User(name=f'__daily_hardening_other__{rid}',metadata_={});db.add_all([u,o]);db.flush();events=[]
  for i in range(105):
   a=AgentAction(user_id=u.id,action_id=uuid4(),tool_name='record_daily_trace',action_type='daily_life',intent='record_daily_trace',mode='record',status='completed',confidence=.9,requires_confirmation=False,execution_order=1,idempotency_key=uuid4().hex,confirmation_status='not_required',attempt_count=1,arguments={'summary':f'사건 {i}','category':None},metadata_={});db.add(a);db.flush()
   e=DailyLifeEvent(user_id=u.id,agent_action_id=a.id,summary=f'사건 {i}',category=None,source='orchestrator',metadata_={'extractor_version':'daily-life-v1','pipeline':'orchestrator-record-daily-trace'},created_at=now if i<2 else now.replace(microsecond=max(0,now.microsecond-i)));db.add(e);events.append(e)
  db.commit();uid,oid=u.id,o.id;event_id=events[0].id;before=(events[0].summary,dict(events[0].metadata_))
 client=TestClient(main.app);single=client.get(f'/daily-life-events/{event_id}',params={'user_id':str(uid)});assert single.status_code==200
 print('[PASS] 1 event ID 조회');assert client.get(f'/daily-life-events/{event_id}',params={'user_id':str(oid)}).status_code==404;print('[PASS] 2 다른 사용자 404')
 assert client.get(f'/daily-life-events/{uuid4()}',params={'user_id':str(uid)}).status_code==404;print('[PASS] 3 없는 ID 404')
 default=client.get(f'/users/{uid}/daily-life-events');assert default.status_code==200 and len(default.json())==50;print('[PASS] 4 list/default 50')
 assert client.get(f'/users/{oid}/daily-life-events').json()==[];print('[PASS] 5 다른 사용자 제외')
 order=[(x['created_at'],x['id']) for x in default.json()];assert order==sorted(order,reverse=True);print('[PASS] 6 created_at,id DESC')
 assert client.get(f'/users/{uid}/daily-life-events',params={'limit':100}).status_code==200 and len(client.get(f'/users/{uid}/daily-life-events',params={'limit':100}).json())==100;print('[PASS] 7 max 100')
 assert client.get(f'/users/{uid}/daily-life-events',params={'limit':0}).status_code==422 and client.get(f'/users/{uid}/daily-life-events',params={'limit':101}).status_code==422;print('[PASS] 8 invalid limit')
 body=single.json();assert body['source']=='orchestrator' and body['metadata']['extractor_version']=='daily-life-v1' and body['metadata']['pipeline']=='orchestrator-record-daily-trace';print('[PASS] 9 source/version/pipeline')
 assert 'content' not in body and body['message_id'] is None;print('[PASS] 10 원문 content 미복제')
 with SessionLocal() as db:e=db.get(DailyLifeEvent,event_id);assert (e.summary,e.metadata_)==before
 print('[PASS] 11 기존 row 비변경');print('SUMMARY=11/11')
if __name__=='__main__':run()
