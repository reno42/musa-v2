export type BooleanOperation = "union" | "subtract" | "intersect" | "exclude";

export interface DesignTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  engine?: "html";
  html?: string;
  css?: string;
  frames?: any[];
  styles?: any[];
  comments?: any[];
  versions?: any[];
  variables?: {
    collections: any[];
    variables: any[];
    bindings: Record<string, any[]>;
  };
  metadata?: {
    createdAt?: string;
    updatedAt?: string;
  };
}
