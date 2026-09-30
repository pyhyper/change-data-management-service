import { NormalizedChange, ProductChangeRecord } from "../../domain/models/change.model.js";

export type DetectionResult =
  | { status: "INSERTED"; hasChanged: true }
  | { status: "NO_CHANGE"; hasChanged: false; reason: "SAME_PAYLOAD_HASH" }
  | { status: "STALE"; hasChanged: false; reason: "SOURCE_TIME_OLDER" };

export class ChangeDetector {
  public evaluate(
    latest: ProductChangeRecord | null,
    incoming: NormalizedChange
  ): DetectionResult {
    if (!latest) {
      return { status: "INSERTED", hasChanged: true };
    }

    if (incoming.sourceUpdatedAt.getTime() < latest.sourceUpdatedAt.getTime()) {
      return { status: "STALE", hasChanged: false, reason: "SOURCE_TIME_OLDER" };
    }

    if (incoming.payloadHash === latest.payloadHash) {
      return { status: "NO_CHANGE", hasChanged: false, reason: "SAME_PAYLOAD_HASH" };
    }

    return { status: "INSERTED", hasChanged: true };
  }
}
