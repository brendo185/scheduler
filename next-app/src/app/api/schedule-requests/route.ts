import { NextResponse } from "next/server";
import { listScheduleRequests } from "../../../server/scheduler-pg";

export async function GET() {
  const { status, body } = await listScheduleRequests();
  return NextResponse.json(body, { status });
}

