import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");
const solutionPipelineDir = path.join(repoRoot, "solutions", "romance-unzipped", "pipeline");

const solutionPythonWrappers = [
  "capture_metadata.py",
  "generate_approval_packet.py",
  "generate_board_review.py",
  "generate_channel_dry_runs.py",
  "generate_clip_candidates.py",
  "generate_connector_runbooks.py",
  "generate_quote_cards.py",
  "generate_social_drafts.py",
  "generate_transcript.py",
  "handoff_manifest.py",
  "migrate_episode_runtime.py",
  "pipeline_common.py",
  "pipeline_llm.py",
  "prepare_transcript.py",
  "render_clip_assets.py",
  "resolve_youtube_latest.py",
  "run_latest_youtube_pipeline.py",
  "test_pipeline_force_semantics.py",
  "update_static_homepage.py",
];

const solutionNodeWrappers = [
  "browser_channel_dry_run.mjs",
  "capture_channel_storage_state.mjs",
  "run_issue_instagram_dry_run.mjs",
  "sync_batch_to_paperclip.mjs",
];

const solutionShellWrappers = [
  "build_episode_batch.sh",
  "detect_new_episode.sh",
  "download_youtube_source.sh",
];

describe("podcast workflow wrapper entrypoints", () => {
  it("routes python wrappers through the root bin directory", () => {
    const genericHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "podcast-workflows", "_pipeline_python_entrypoint.py"),
      "utf8",
    );
    const legacyHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "romance-unzipped", "_pipeline_python_entrypoint.py"),
      "utf8",
    );

    expect(genericHelper).toContain('target = repo_root / "bin" / wrapper_name');
    expect(legacyHelper).toContain('target = repo_root / "bin" / wrapper_name');
  });

  it("routes node wrappers through the root bin directory", () => {
    const genericHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "podcast-workflows", "_pipeline_node_entrypoint.mjs"),
      "utf8",
    );
    const legacyHelper = fs.readFileSync(
      path.join(repoRoot, "bin", "romance-unzipped", "_pipeline_node_entrypoint.mjs"),
      "utf8",
    );

    expect(genericHelper).toContain('const target = path.join(repoRoot, "bin", wrapperName);');
    expect(legacyHelper).toContain('const target = path.join(repoRoot, "bin", wrapperName);');
  });

  it("keeps the branded solution pipeline as thin wrappers around root bin", () => {
    const pythonCompat = fs.readFileSync(
      path.join(solutionPipelineDir, "_pipeline_python_compat.py"),
      "utf8",
    );
    const nodeHelper = fs.readFileSync(
      path.join(solutionPipelineDir, "_pipeline_node_entrypoint.mjs"),
      "utf8",
    );
    const shellHelper = fs.readFileSync(
      path.join(solutionPipelineDir, "_pipeline_shell_entrypoint.sh"),
      "utf8",
    );

    expect(pythonCompat).toContain('target = repo_root / "bin" / wrapper_path.name');
    expect(nodeHelper).toContain('const target = path.join(repoRoot, "bin", wrapperName);');
    expect(shellHelper).toContain('exec "$repo_root/bin/$wrapper_name" "$@"');

    for (const fileName of solutionPythonWrappers) {
      const contents = fs.readFileSync(path.join(solutionPipelineDir, fileName), "utf8");
      expect(contents).toContain(
        "from _pipeline_python_compat import export_root_module, run_root_script",
      );
      expect(contents).toContain('if __name__ == "__main__":');
    }

    for (const fileName of solutionNodeWrappers) {
      const contents = fs.readFileSync(path.join(solutionPipelineDir, fileName), "utf8");
      expect(contents).toContain('import { main } from "./_pipeline_node_entrypoint.mjs";');
      expect(contents).toContain("await main();");
    }

    for (const fileName of solutionShellWrappers) {
      const contents = fs.readFileSync(path.join(solutionPipelineDir, fileName), "utf8");
      expect(contents).toContain('source "${SCRIPT_DIR}/_pipeline_shell_entrypoint.sh"');
      expect(contents).toContain("pipeline_exec_root_bin");
    }
  });
});
