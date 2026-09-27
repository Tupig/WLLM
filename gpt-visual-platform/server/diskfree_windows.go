//go:build windows

package main

// Windows 暂不检查磁盘空间（返回 -1 表示未知，不参与断言）。
func diskFreeMB(path string) (int64, error) {
	return -1, nil
}
