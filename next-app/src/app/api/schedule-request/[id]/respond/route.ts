import { NextResponse } from "next/server";
import { respondToScheduleRequest, type ScheduleResponse } from "../../../../../server/scheduler";

interface Params {
  params: { id: string };
}

type RespondBody = Partial<ScheduleResponse> & {
  selectedDate?: string;
  selectedSlot?: string;
  selectedDates?: string[];
};

export async function POST(req: Request, { params }: Params) {
  const json = (await req.json()) as RespondBody;
  const { status, body } = respondToScheduleRequest(params.id, json);
  return NextResponse.json(body, { status });
}

