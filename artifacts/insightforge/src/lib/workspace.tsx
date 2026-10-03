import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { ListDatasetsResponse, RegisterDatasetResponse } from "@workspace/api-zod";
import { apiRequest } from "./api";

export type DatasetRecord = ReturnType<typeof RegisterDatasetResponse.parse>;

interface WorkspaceState {
  datasets: DatasetRecord[];
  activeDataset: DatasetRecord | null;
  activeDatasetId: string;
  setActiveDatasetId: (id: string) => void;
  refreshDatasets: () => Promise<DatasetRecord[]>;
  isLoadingDatasets: boolean;
  datasetError: string;
}

const WorkspaceContext = createContext<WorkspaceState | null>(null);
const ACTIVE_DATASET_KEY = "insightforge.activeDatasetId";

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<DatasetRecord[]>([]);
  const [activeDatasetId, setActiveDatasetIdState] = useState(
    () => window.localStorage.getItem(ACTIVE_DATASET_KEY) ?? "",
  );
  const [isLoadingDatasets, setIsLoadingDatasets] = useState(true);
  const [datasetError, setDatasetError] = useState("");

  const refreshDatasets = useCallback(async () => {
    setDatasetError("");
    try {
      const response = await apiRequest("/datasets", ListDatasetsResponse);
      setDatasets(response.datasets);
      setActiveDatasetIdState((current) => {
        const next = response.datasets.some((dataset) => dataset.id === current)
          ? current
          : response.datasets[0]?.id ?? "";
        if (next) window.localStorage.setItem(ACTIVE_DATASET_KEY, next);
        else window.localStorage.removeItem(ACTIVE_DATASET_KEY);
        return next;
      });
      return response.datasets;
    } catch (error) {
      setDatasetError(
        error instanceof Error ? error.message : "Could not load datasets.",
      );
      throw error;
    } finally {
      setIsLoadingDatasets(false);
    }
  }, []);

  useEffect(() => {
    void refreshDatasets().catch(() => undefined);
  }, [refreshDatasets]);

  const setActiveDatasetId = useCallback((id: string) => {
    setActiveDatasetIdState(id);
    if (id) window.localStorage.setItem(ACTIVE_DATASET_KEY, id);
    else window.localStorage.removeItem(ACTIVE_DATASET_KEY);
  }, []);

  const activeDataset =
    datasets.find((dataset) => dataset.id === activeDatasetId) ?? null;
  const value = useMemo(
    () => ({
      datasets,
      activeDataset,
      activeDatasetId,
      setActiveDatasetId,
      refreshDatasets,
      isLoadingDatasets,
      datasetError,
    }),
    [
      datasets,
      activeDataset,
      activeDatasetId,
      setActiveDatasetId,
      refreshDatasets,
      isLoadingDatasets,
      datasetError,
    ],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider.");
  }
  return workspace;
}