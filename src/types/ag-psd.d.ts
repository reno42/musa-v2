declare module "ag-psd" {
  export interface PsdLayer {
    name?: string;
    visible?: boolean;
    left?: number;
    top?: number;
    right?: number;
    bottom?: number;
    canvas?: HTMLCanvasElement;
    text?: {
      text?: string;
      style?: {
        fontSize?: { value?: number }[];
        fillColor?: number[][];
      };
    };
    children?: PsdLayer[];
  }
  export interface Psd {
    width: number;
    height: number;
    children?: PsdLayer[];
    image?: HTMLCanvasElement;
  }
  export function readPsd(buffer: ArrayBuffer | Uint8Array, options?: any): Psd;
}
