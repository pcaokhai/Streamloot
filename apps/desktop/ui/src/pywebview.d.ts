import type { ApiConfig } from "./types";

declare global {
  interface Window {
    pywebview?: {
      api: {
        get_api_config(): Promise<ApiConfig>;
        reveal_in_finder(path: string): Promise<boolean>;
        path_exists(path: string): Promise<boolean>;
      };
    };
  }
}

export {};
