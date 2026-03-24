#!/usr/bin/env python3
import argparse
import ctypes
from ctypes import c_double, c_uint32, c_void_p
import time


class CGPoint(ctypes.Structure):
    _fields_ = [("x", c_double), ("y", c_double)]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--x", type=float, required=True)
    parser.add_argument("--y", type=float, required=True)
    parser.add_argument("--move-only", action="store_true")
    parser.add_argument("--hold-ms", type=int, default=120)
    args = parser.parse_args()

    quartz = ctypes.CDLL("/System/Library/Frameworks/ApplicationServices.framework/ApplicationServices")

    quartz.CGEventCreateMouseEvent.restype = c_void_p
    quartz.CGEventCreateMouseEvent.argtypes = [c_void_p, c_uint32, CGPoint, c_uint32]
    quartz.CGEventPost.restype = None
    quartz.CGEventPost.argtypes = [c_uint32, c_void_p]
    quartz.CFRelease.restype = None
    quartz.CFRelease.argtypes = [c_void_p]

    kCGHIDEventTap = 0
    kCGEventMouseMoved = 5
    kCGEventLeftMouseDown = 1
    kCGEventLeftMouseUp = 2
    kCGMouseButtonLeft = 0

    point = CGPoint(args.x, args.y)

    def post(event_type: int) -> None:
      event = quartz.CGEventCreateMouseEvent(None, event_type, point, kCGMouseButtonLeft)
      if not event:
          raise RuntimeError(f"Failed to create mouse event {event_type}")
      try:
          quartz.CGEventPost(kCGHIDEventTap, event)
      finally:
          quartz.CFRelease(event)

    post(kCGEventMouseMoved)
    if not args.move_only:
        post(kCGEventLeftMouseDown)
        time.sleep(max(args.hold_ms, 0) / 1000.0)
        post(kCGEventLeftMouseUp)

    print(f"ok {int(args.x)} {int(args.y)} {'move' if args.move_only else 'click'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
