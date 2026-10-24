import { mkdir, writeFile } from "node:fs/promises";
import { dossier } from "./helpers";
import { emptyState } from "../src/lib/chess/coordinator.server";
const data = dossier();
data.fetchedAt = new Date().toISOString();
data.tournaments[0].nextGame = {round:3,board:1,color:"white",opponent:"Kalniņš, Roberts Aleksandrs",opponentTitle:"",opponentRating:1450,opponentFed:"LAT",opponentPoints:2,url:"https://chess-results.com/tnr1.aspx",startsAt:"12:30"};
const state = emptyState(); state.nextAllowedAt = Date.now() + 60_000; state.snapshot = {ok:true,dossier:data,stale:false,warning:null};
await mkdir(".cache/visual",{recursive:true});await writeFile(".cache/visual/source-v2.json",JSON.stringify(state));
