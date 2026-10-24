import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTIVE_TTL, HISTORY_TTL, SEARCH_TTL, REQUEST_GAP, SourceCoordinator, type CacheState, type SourceContext } from "../src/lib/chess/coordinator.server";
import { dossier } from "./helpers";
import type { LoadResult } from "../src/lib/chess/types";

type Success = Extract<LoadResult,{ok:true}>;
function harness() {
  let clock = new Date("2026-10-24T09:00:00Z").getTime(); let saved: CacheState | undefined;
  const times: number[] = []; const statuses: Array<[number, Record<string,string>]> = [];
  const store = { read: async () => saved ? structuredClone(saved) : undefined, write: async (s: CacheState) => { saved = structuredClone(s); } };
  const fetcher = (async () => { times.push(clock); const [status,headers] = statuses.shift() || [200,{}]; return new Response("ok", {status,headers}); }) as typeof fetch;
  const create = () => new SourceCoordinator(store,fetcher,() => clock,async ms => { clock += ms; });
  const job = async (source: SourceContext): Promise<Success> => {
    await source.memo("search", SEARCH_TTL, async () => { await source.request("https://chess-results.com/search"); return [1]; });
    await source.memo("card:1", ACTIVE_TTL, async () => { await source.request("https://chess-results.com/card"); return 1; });
    await source.memo("meta:1", HISTORY_TTL, async () => { await source.request("https://chess-results.com/history"); return 2; });
    return {ok:true,dossier:dossier(),stale:false,warning:null};
  };
  return {create,job,times,statuses,advance:(ms:number)=>{clock+=ms;},state:()=>saved,setState:(state:CacheState)=>{saved=state;}};
}
test("many visitors share one job; manual/automatic loads cannot bypass cooldown", async () => {
  const h=harness(); const c=h.create(); const results=await Promise.all(Array.from({length:20},()=>c.load(h.job)));
  assert.equal(h.times.length,3); assert.ok(results.every(r=>r.ok));
  await c.load(h.job); assert.equal(h.times.length,3);
  assert.ok(h.times.slice(1).every((t,i)=>t-h.times[i]>=REQUEST_GAP));
});
test("restart retains gate and archived/search entries; active refresh fetches only one card",async()=>{
  const h=harness(); await h.create().load(h.job); await h.create().load(h.job); assert.equal(h.times.length,3);
  h.advance(ACTIVE_TTL+1); await h.create().load(h.job); assert.equal(h.times.length,4);
});
test("429 aborts the batch, honors Retry-After, keeps last good snapshot and survives restart", async()=>{
  const h=harness(); await h.create().load(h.job); h.advance(ACTIVE_TTL+1);h.statuses.push([429,{'Retry-After':'7200'}]);
  const result=await h.create().load(h.job); assert.equal(result.ok && result.stale,true);assert.equal(h.times.length,4);
  h.advance(60*60_000); await h.create().load(h.job); assert.equal(h.times.length,4);
  assert.ok(h.state()!.failures>0);
});
test("HTTP-date Retry-After and forbidden redirects are respected",async()=>{
  const h=harness(); h.statuses.push([503,{'Retry-After':'Sat, 24 Oct 2026 12:00:00 GMT'}]);
  const result=await h.create().load(h.job);assert.equal(result.ok,false);assert.ok(h.state()!.nextAllowedAt>=Date.parse('2026-10-24T12:00:00Z'));
  const second=harness();const denied=await second.create().load(async source=>{await source.request('https://evil.example/');return {ok:true,dossier:dossier(),stale:false,warning:null};});assert.equal(denied.ok,false);assert.equal(second.times.length,0);
});
test("invalid parsed pages never replace persistent good data; failed cold starts do not loop",async()=>{
  const h=harness();await h.create().load(h.job);h.advance(ACTIVE_TTL+1);
  const bad=await h.create().load(async source=>{await source.memo('card:1',ACTIVE_TTL,async()=>{throw Error('changed HTML');});throw Error('unreachable');});
  assert.equal(bad.ok && bad.stale,true);assert.equal(h.state()!.entries['card:1'].value,1);
  const cold=harness();cold.statuses.push([403,{}]);await cold.create().load(cold.job);await cold.create().load(cold.job);assert.equal(cold.times.length,1);
});
test("idle history does not cause minute-by-minute source polling",async()=>{
  const h=harness();const idle=async(source:SourceContext):Promise<Success>=>{
    await source.request('https://chess-results.com/history');const data=dossier();data.tournaments.forEach(t=>{t.startDate='2025-01-01';t.endDate='2025-01-01';});return {ok:true,dossier:data,stale:false,warning:null};
  };
  await h.create().load(idle);h.advance(ACTIVE_TTL+1);await h.create().load(idle);assert.equal(h.times.length,1);
  h.advance(SEARCH_TTL);await h.create().load(idle);assert.equal(h.times.length,2);
});
test("active source checks run every minute, independently of visitors",async()=>{
  assert.equal(ACTIVE_TTL,60_000);const h=harness();await h.create().load(h.job);h.advance(59_000);await h.create().load(h.job);assert.equal(h.times.length,3);h.advance(1_001);await h.create().load(h.job);assert.equal(h.times.length,4);
});
test("first failure retries after one minute and retains the cause through restart",async()=>{
  const h=harness();h.statuses.push([500,{}]);const failed=await h.create().load(h.job);assert.equal(failed.ok,false);
  const cached=await h.create().load(h.job);assert.equal(cached.ok,false);assert.match(!cached.ok ? cached.error : '',/500/);
  assert.equal(h.times.length,1);h.advance(60_001);const recovered=await h.create().load(h.job);assert.equal(recovered.ok,true);
});
test("legacy first-error guard is shortened, but an old long block is preserved",async()=>{
  const h=harness();h.setState({version:2,entries:{},failures:1,nextRequestAt:Date.parse('2026-10-24T09:00:02Z'),nextAllowedAt:Date.parse('2026-10-24T09:15:00Z')});
  await h.create().load(h.job);assert.equal(h.times.length,0);h.advance(60_001);await h.create().load(h.job);assert.equal(h.times.length,3);
  const blocked=harness();blocked.setState({version:2,entries:{},failures:1,nextRequestAt:Date.parse('2026-10-24T09:00:02Z'),nextAllowedAt:Date.parse('2026-10-24T10:00:00Z')});blocked.advance(60_001);await blocked.create().load(blocked.job);assert.equal(blocked.times.length,0);
});
