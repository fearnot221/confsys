import { useQuery } from "@tanstack/react-query";
import { createClient } from "@confsys/sdk";
const client = createClient();
export function useInstance() {
  return useQuery({
    queryKey: ["public", "instance"],
    queryFn: ({ signal }) => client.getInstance(signal),
    retry: false,
  });
}
