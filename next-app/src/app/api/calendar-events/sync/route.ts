import { NextResponse } from "next/server";
import { syncCalendarEvents } from "../../../../server/scheduler";

export async function POST(req: Request) {
  const json = (await req.json()) as { events?: unknown };
  const { status, body } = syncCalendarEvents(json);
  return NextResponse.json(body, { status });
}

