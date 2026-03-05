import { NextResponse } from "next/server";
import {
  getScheduleRequestById,
  patchScheduleRequest,
  deleteScheduleRequest,
} from "../../../../server/scheduler-pg";

interface Params {
  params: { id: string };
}

export async function GET(_req: Request, { params }: Params) {
  const { status, body } = await getScheduleRequestById(params.id);
  return NextResponse.json(body, { status });
}

export async function PATCH(req: Request, { params }: Params) {
  const json = (await req.json()) as {
    archive?: boolean;
    removeResponse?: { selectedDate: string; selectedSlot: string };
  };
  const { status, body } = await patchScheduleRequest(params.id, json);
  return NextResponse.json(body, { status });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { status, body } = await deleteScheduleRequest(params.id);
  return NextResponse.json(body, { status });
}

