export type BooleanOperation = "union" | "subtract" | "intersect" | "exclude";

export interface DesignTemplate {
  id: string;
  name: string;
  width: number;
  height: number;
  canvas?: any;
  pages?: any[];
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
