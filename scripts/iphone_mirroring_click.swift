import CoreGraphics
import Foundation

struct Config {
  let x: Double
  let y: Double
  let moveOnly: Bool
}

func parseArgs() -> Config? {
  var x: Double?
  var y: Double?
  var moveOnly = false

  var index = 1
  while index < CommandLine.arguments.count {
    let arg = CommandLine.arguments[index]
    switch arg {
    case "--x":
      index += 1
      guard index < CommandLine.arguments.count, let value = Double(CommandLine.arguments[index]) else {
        fputs("Missing numeric value for --x\n", stderr)
        return nil
      }
      x = value
    case "--y":
      index += 1
      guard index < CommandLine.arguments.count, let value = Double(CommandLine.arguments[index]) else {
        fputs("Missing numeric value for --y\n", stderr)
        return nil
      }
      y = value
    case "--move-only":
      moveOnly = true
    default:
      fputs("Unknown argument: \(arg)\n", stderr)
      return nil
    }
    index += 1
  }

  guard let x, let y else {
    fputs("Usage: swift scripts/iphone_mirroring_click.swift --x <absX> --y <absY> [--move-only]\n", stderr)
    return nil
  }

  return Config(x: x, y: y, moveOnly: moveOnly)
}

guard let config = parseArgs() else {
  exit(2)
}

let point = CGPoint(x: config.x, y: config.y)

func post(_ type: CGEventType, at point: CGPoint) {
  guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else {
    fputs("Failed to create mouse event for \(type.rawValue)\n", stderr)
    exit(1)
  }
  event.post(tap: .cghidEventTap)
}

post(.mouseMoved, at: point)
usleep(100_000)

if !config.moveOnly {
  post(.leftMouseDown, at: point)
  usleep(60_000)
  post(.leftMouseUp, at: point)
}

print("ok \(Int(config.x)) \(Int(config.y))\(config.moveOnly ? " move" : " click")")
