import { toast } from "sonner";

/** 一句話的提示，幾秒後自己消失；字越多停越久 */
export function notify(message: string): void {
  toast(message, { duration: Math.max(2600, Math.min(8000, message.length * 90)) });
}
