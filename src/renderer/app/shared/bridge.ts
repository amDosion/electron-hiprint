// 统一的 preload 桥获取：缺失即在窗口初始化期抛错（说明窗口未经正确 preload 加载）。
// 返回非可选类型 T，使调用方在 async/闭包内引用无需重复收窄
//（const 经可选属性读出时闭包不保留收窄，故这里集中处理一次）。
export function requireBridge<T>(
  value: T | undefined,
  bridgeName: string,
  preloadFile: string,
): T {
  if (!value) {
    throw new Error(
      `${bridgeName} bridge 未注入：请确认窗口经 ${preloadFile} 加载`,
    );
  }
  return value;
}
