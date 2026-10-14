import { useQuery } from "@tanstack/react-query";
import { createClient } from "@confsys/sdk";
const client = createClient();
export function useHealth() {
  const query = useQuery({
    queryKey: ["infrastructure", "readiness"],
    queryFn: () => client.getReadiness(),
    retry: false,
    staleTime: 5000,
    refetchInterval: 15000,
  });
  return {
    phase: query.isPending
      ? ("loading" as const)
      : query.isError
        ? ("error" as const)
        : query.data.status === "ready"
          ? ("ready" as const)
          : ("degraded" as const),
    dependencies: query.data?.dependencies,
    busy: query.isFetching,
    refresh: () => {
      void query.refetch();
    },
  };
}
