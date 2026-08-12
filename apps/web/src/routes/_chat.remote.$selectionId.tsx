// FILE: _chat.remote.$selectionId.tsx
// Purpose: Routes a unified-sidebar remote selection into an isolated right-hand detail frame.
// Layer: Route container

import { createFileRoute } from "@tanstack/react-router";

import { RemoteThreadFrame } from "../components/RemoteThreadFrame";

function RemoteThreadRouteView() {
  const selectionId = Route.useParams({ select: (params) => params.selectionId });
  return <RemoteThreadFrame selectionId={selectionId} />;
}

export const Route = createFileRoute("/_chat/remote/$selectionId")({
  component: RemoteThreadRouteView,
});
