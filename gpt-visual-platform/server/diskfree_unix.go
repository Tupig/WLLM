//go:build !windows

package main

import "syscall"

// diskFreeMB 返回路径所在磁盘的可用空间（MB）。Windows 走 diskfree_windows.go。
func diskFreeMB(path string) (int64, error) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(path, &st); err != nil {
		return 0, err
	}
	return int64(st.Bavail) * int64(st.Bsize) / (1024 * 1024), nil
}
