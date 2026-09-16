import {runWorker} from '@/services/worker';
import {failure} from '@/lib/server';
export const maxDuration=300;
export async function GET(req:Request){if(!process.env.CRON_SECRET||req.headers.get('authorization')!==`Bearer ${process.env.CRON_SECRET}`)return Response.json({error:'Unauthorized'},{status:401});try{return Response.json(await runWorker())}catch(e){return failure(e)}}
