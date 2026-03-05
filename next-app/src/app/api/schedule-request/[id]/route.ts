import { NextResponse } from "next/server";
import {
  getScheduleRequestById,
  patchScheduleRequest,
  deleteScheduleRequest,
} from "../../../../server/scheduler";

interface Params {
  params: { id: string };
}

export function GET(_req: Request, { params }: Params) {
  const { status, body } = getScheduleRequestById(params.id);
  return NextResponse.json(body, { status });
}

export async function PATCH(req: Request, { params }: Params) {
  const json = (await req.json()) as {
    archive?: boolean;
    removeResponse?: { selectedDate: string; selectedSlot: string };
  };
  const { status, body } = patchScheduleRequest(params.id, json);
  return NextResponse.json(body, { status });
}

export function DELETE(_req: Request, { params }: Params) {
  const { status, body } = deleteScheduleRequest(params.id);
  return NextResponse.json(body, { status });
}

