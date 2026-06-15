//! SKILL.md parser — YAML frontmatter + Markdown body.

use crate::Skill;
use encorehub_core::SkillTool;
use std::path::Path;

/// Parsed SKILL.md frontmatter.
#[derive(Debug, serde::Deserialize)]
struct SkillFrontmatter {
    name: String,
    description: String,
    #[serde(default = "default_version")]
    version: String,
    #[serde(default)]
    author: String,
    #[serde(default)]
    triggers: Vec<String>,
    #[serde(default)]
    tools: Vec<ToolFrontmatter>,
}

#[derive(Debug, serde::Deserialize)]
struct ToolFrontmatter {
    name: String,
    description: String,
    #[serde(default)]
    parameters: serde_yaml::Value,
}

fn default_version() -> String {
    "1.0.0".into()
}

/// Parse a SKILL.md file from a directory path.
/// Returns None if the file doesn't exist or can't be parsed.
pub fn parse_skill_md(dir: &Path) -> Option<Skill> {
    let md_path = dir.join("SKILL.md");
    let content = std::fs::read_to_string(&md_path).ok()?;
    parse_skill_content(&content, dir)
}

/// Parse SKILL.md content string.
pub fn parse_skill_content(content: &str, dir: &Path) -> Option<Skill> {
    // Split frontmatter from body
    let parts: Vec<&str> = content.splitn(3, "---").collect();
    if parts.len() < 3 {
        return None;
    }

    let yaml_str = parts[1];
    let fm: SkillFrontmatter = serde_yaml::from_str(yaml_str).ok()?;

    let tools: Vec<SkillTool> = fm
        .tools
        .into_iter()
        .map(|t| SkillTool {
            name: t.name,
            description: t.description,
            parameters_schema: serde_json::to_string(&t.parameters).unwrap_or_default(),
        })
        .collect();

    Some(Skill {
        id: fm.name.clone(),
        name: fm.name,
        description: fm.description,
        version: fm.version,
        author: fm.author,
        enabled: true,
        builtin: true,
        triggers: fm.triggers,
        tools,
        install_path: dir.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn test_parse_skill_md() {
        let content = r#"---
name: test-skill
description: A test skill
triggers:
  - "test"
  - "demo"
tools:
  - name: test_tool
    description: A test tool
    parameters:
      input:
        type: string
---

# Test Skill

Body text here.
"#;
        let skill = parse_skill_content(content, &PathBuf::from("/tmp/test-skill"));
        assert!(skill.is_some());
        let s = skill.unwrap();
        assert_eq!(s.name, "test-skill");
        assert_eq!(s.triggers.len(), 2);
        assert_eq!(s.tools.len(), 1);
        assert_eq!(s.tools[0].name, "test_tool");
    }
}
