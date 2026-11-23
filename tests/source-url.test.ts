import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isChessResultsUrl } from '../src/lib/chess/source-url';
import { SourceCoordinator, type CacheState } from '../src/lib/chess/coordinator.server';
import { scrapeDossier } from '../src/lib/chess/scrape.server';
import { dossier, fixture } from './helpers';

test('observed S2 redirect and numbered service nodes are accepted over HTTPS',()=>{
  for(const url of ['https://chess-results.com/','https://www.chess-results.com/','https://S2.chess-results.com/spielersuche.aspx?lan=1&SNode=S0','https://s1.chess-results.com/','https://s12.chess-results.com/']) assert.equal(isChessResultsUrl(new URL(url)),true,url);
});
test('external redirects, lookalike domains, plaintext, credentials and alternate ports are rejected',()=>{
  for(const url of ['https://evil.example/','https://chess-results.com.evil.example/','https://s2-chess-results.com/','https://arbitrary.chess-results.com/','http://s2.chess-results.com/','https://s2.chess-results.com:8443/','https://user:secret@s2.chess-results.com/']) assert.equal(isChessResultsUrl(new URL(url)),false,url);
});
test('full search, POST and archived tournament pipeline follows the S2 redirect with a shared cache',async()=>{
  const calls:Array<{url:string;method:string}>=[];
  let state: CacheState | undefined;let clock=Date.now();
  const fetcher=(async(input,init)=>{
    const url=new URL(String(input));calls.push({url:url.href,method:init?.method || 'GET'});
    assert.equal(init?.redirect,'manual');
    if(url.hostname==='chess-results.com') return new Response(null,{status:302,headers:{Location:`https://S2.chess-results.com${url.pathname}${url.search}${url.search ? '&' : '?'}SNode=S0`}});
    assert.equal(url.hostname,'s2.chess-results.com');
    if(url.pathname==='/spielersuche.aspx') {
      if(init?.method==='POST') {
        assert.equal(new URLSearchParams(String(init.body)).get('ctl00$P1$txt_fideID'),'11662255');
        return new Response(fixture('search').replaceAll('2026/','2025/'));
      }
      return new Response('<input name="__VIEWSTATE" value="test-state"><input name="__VIEWSTATEGENERATOR" value="test"><input name="__EVENTVALIDATION" value="test">');
    }
    if(url.searchParams.get('turdet')==='YES') return new Response(fixture('archived-tournament'));
    if(url.searchParams.get('art')==='9') return new Response(fixture('player-card'));
    throw Error(`Unexpected source request ${url}`);
  }) as typeof fetch;
  const coordinator=new SourceCoordinator({read:async()=>state,write:async value=>{state=value;}},fetcher,()=>clock,async ms=>{clock+=ms;});
  const result=await coordinator.load(scrapeDossier);
  assert.equal(result.ok,true,!result.ok ? result.error : '');
  if(result.ok){assert.equal(result.dossier.tournaments.length,4);assert.equal(result.dossier.totals.games,8);assert.match(result.dossier.partialNote || '',/paslēpts/);}
  const before=calls.length;await coordinator.load(scrapeDossier);assert.equal(calls.length,before);
  assert.ok(calls.some(c=>c.method==='POST' && new URL(c.url).hostname==='s2.chess-results.com'));
});
test('deploying the S-node fix repairs only the old generic allowlist cooldown',async()=>{
  let state: CacheState={version:2,policy:1,entries:{},failures:3,lastError:'Avota novirzīšanas adrese nav atļauta.',nextAllowedAt:Date.now()+900_000,nextRequestAt:0};
  const coordinator=new SourceCoordinator({read:async()=>state,write:async value=>{state=value;}},(async()=>new Response('ok')) as typeof fetch);
  const result=await coordinator.load(async source=>{await source.request('https://S2.chess-results.com/');return {ok:true,dossier:dossier(),stale:false,warning:null};});
  assert.equal(result.ok,true);
});

function pipeline(override: (url: URL, init?: RequestInit) => Response | undefined) {
  let state: CacheState | undefined; let clock = Date.parse('2026-11-18T10:00:00Z'); let ids: string[] = [];
  const fetcher = (async (input, init) => {
    const url = new URL(String(input));
    const custom = override(url, init); if (custom) return custom;
    if (url.pathname === '/spielersuche.aspx') {
      if (init?.method === 'POST') return new Response(fixture('search').replaceAll('2026/', '2025/'));
      return new Response('<input name="__VIEWSTATE" value="s"><input name="__VIEWSTATEGENERATOR" value="g"><input name="__EVENTVALIDATION" value="v">');
    }
    ids.push(url.pathname);
    if (url.searchParams.get('turdet') === 'YES' && !url.searchParams.get('art')) return new Response(fixture('archived-tournament'));
    if (url.searchParams.get('art') === '9') return new Response(fixture('player-card'));
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
  const coordinator = new SourceCoordinator({ read: async () => state, write: async (value) => { state = value; } }, fetcher, () => clock, async (ms) => { clock += ms; });
  return { coordinator, state: () => state, clock: () => clock, paths: () => ids };
}

test('a refusal inside an optional lookup still reaches the guard', async () => {
  const p = pipeline((url) => (url.searchParams.get('fed') === 'LAT' ? new Response('slow down', { status: 429, headers: { 'Retry-After': '7200' } }) : undefined));
  const result = await p.coordinator.load(scrapeDossier);
  assert.equal(result.ok, false);
  assert.ok((p.state()?.retryAfterUntil ?? 0) >= p.clock() + 7_000_000, 'Retry-After must be kept');
});

test('one old tournament that changed layout does not block the others', async () => {
  let first = '';
  const p = pipeline((url) => {
    if (url.searchParams.get('art') !== '9') return undefined;
    first ||= url.pathname;
    return url.pathname === first ? new Response('<html><title>Chess-Results</title><p>changed</p></html>') : undefined;
  });
  const result = await p.coordinator.load(scrapeDossier);
  assert.equal(result.ok, true, !result.ok ? result.error : '');
  if (result.ok) {
    assert.equal(result.dossier.tournaments.filter((t) => t.partial).length, 1);
    assert.match(result.dossier.partialNote ?? '', /neizdevās/);
  }
});

test('scraped links stay on chess-results over HTTPS', async () => {
  const { chessResultsHref } = await import('../src/lib/chess/source-url');
  assert.equal(chessResultsHref('tnr1.aspx?lan=1&art=9&snr=4'), 'https://chess-results.com/tnr1.aspx?lan=1&art=9&snr=4');
  assert.equal(chessResultsHref('./tnr2.aspx'), 'https://chess-results.com/tnr2.aspx');
  assert.equal(chessResultsHref('http://s2.chess-results.com/tnr3.aspx'), 'https://s2.chess-results.com/tnr3.aspx');
  for (const bad of ['https://evil.example/', 'javascript:alert(1)', '//evil.example/x', 'https://chess-results.com.evil.example/', 'data:text/html,x']) {
    assert.equal(chessResultsHref(bad), 'https://chess-results.com/', bad);
  }
});
