const std = @import("std");
const builtin = @import("builtin");

pub fn module(b: *std.Build) *std.build.Module {
    return b.createModule(.{
        .source_file = .{ .path = (comptime thisDir()) ++ "/src/main.zig" },
    });
}

fn thisDir() []const u8 {
    return std.fs.path.dirname(@src().file) orelse ".";
}

pub const Options = struct {};

pub fn build(b: *std.Build) !void {
    const target = b.standardTargetOptions(.{});
    const optimize = b.standardOptimizeOption(.{});

    const tests = b.addTest(.{
        .name = "js-test",
        .kind = .test_exe,
        .root_source_file = .{ .path = "src/main.zig" },
        .target = target,
        .optimize = optimize,
    });
    tests.install();

    const test_step = b.step("test", "Run tests");
    const tests_run = tests.run();
    test_step.dependOn(&tests_run.step);

    // Example
    {
        const wasm = b.addSharedLibrary(.{
            .name = "example",
            .root_source_file = .{ .path = "example/main.zig" },
            .target = .{ .cpu_arch = .wasm32, .os_tag = .freestanding },
            .optimize = optimize,
        });
        wasm.setOutputDir("example");
        wasm.addModule("zig-js", module(b));

        const step = b.step("example", "Build the example project (Zig only)");
        step.dependOn(&wasm.step);
    }
}
