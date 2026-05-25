/// <reference types="vite/client" />

export {};

// File System Access API — partial typings for what we use.
declare global {
  interface FileSystemHandlePermissionDescriptor {
    mode?: 'read' | 'readwrite';
  }

  interface FileSystemFileHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
  }

  interface FileSystemDirectoryHandle {
    queryPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    requestPermission?(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>;
    values(): AsyncIterable<FileSystemHandle>;
  }

  interface Window {
    showDirectoryPicker?(options?: {
      mode?: 'read' | 'readwrite';
      id?: string;
      startIn?: string;
    }): Promise<FileSystemDirectoryHandle>;
  }
}
