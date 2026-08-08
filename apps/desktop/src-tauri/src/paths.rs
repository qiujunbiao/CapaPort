use crate::{RuntimeError, RuntimeResult};
use parking_lot::RwLock;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;

#[derive(Clone, Default)]
pub struct PathPolicy {
    roots: Arc<RwLock<Vec<PathBuf>>>,
}

impl PathPolicy {
    pub fn new(roots: impl IntoIterator<Item = PathBuf>) -> RuntimeResult<Self> {
        let policy = Self::default();
        for root in roots {
            policy.add_root(root)?;
        }
        Ok(policy)
    }

    pub fn add_root(&self, root: PathBuf) -> RuntimeResult<PathBuf> {
        let canonical = root
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !canonical.is_dir() {
            return Err(RuntimeError::PathNotAllowed);
        }
        let mut roots = self.roots.write();
        if !roots.contains(&canonical) {
            roots.push(canonical.clone());
            roots.sort();
        }
        Ok(canonical)
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.roots.read().clone()
    }

    pub fn replace_roots(&self, roots: impl IntoIterator<Item = PathBuf>) -> RuntimeResult<()> {
        let mut canonical_roots = Vec::new();
        for root in roots {
            let canonical = root
                .canonicalize()
                .map_err(|_| RuntimeError::PathNotAllowed)?;
            if !canonical.is_dir() {
                return Err(RuntimeError::PathNotAllowed);
            }
            canonical_roots.push(canonical);
        }
        canonical_roots.sort();
        canonical_roots.dedup();
        *self.roots.write() = canonical_roots;
        Ok(())
    }

    pub fn resolve(&self, root: &Path, relative: &Path) -> RuntimeResult<PathBuf> {
        if relative.as_os_str().is_empty()
            || relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, Component::Normal(_)))
        {
            return Err(RuntimeError::PathNotAllowed);
        }
        let canonical_root = root
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !self.roots.read().contains(&canonical_root) {
            return Err(RuntimeError::PathNotAllowed);
        }
        let candidate = canonical_root.join(relative);
        if let Ok(metadata) = std::fs::symlink_metadata(&candidate) {
            if metadata.file_type().is_symlink() {
                return Err(RuntimeError::SymlinkRejected);
            }
            let canonical = candidate
                .canonicalize()
                .map_err(|_| RuntimeError::PathNotAllowed)?;
            if !canonical.starts_with(&canonical_root) {
                return Err(RuntimeError::PathNotAllowed);
            }
            return Ok(canonical);
        }
        let mut ancestor = candidate.parent().ok_or(RuntimeError::PathNotAllowed)?;
        while !ancestor.exists() {
            ancestor = ancestor.parent().ok_or(RuntimeError::PathNotAllowed)?;
        }
        let canonical_ancestor = ancestor
            .canonicalize()
            .map_err(|_| RuntimeError::PathNotAllowed)?;
        if !canonical_ancestor.starts_with(&canonical_root) {
            return Err(RuntimeError::PathNotAllowed);
        }
        Ok(candidate)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn rejects_traversal_and_non_allowlisted_roots() {
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        let policy = PathPolicy::new([allowed.path().to_path_buf()]).unwrap();
        assert!(matches!(
            policy.resolve(allowed.path(), Path::new("../escape")),
            Err(RuntimeError::PathNotAllowed)
        ));
        assert!(matches!(
            policy.resolve(outside.path(), Path::new("file")),
            Err(RuntimeError::PathNotAllowed)
        ));
    }

    #[cfg(unix)]
    #[test]
    fn rejects_symlink_escape() {
        use std::os::unix::fs::symlink;
        let allowed = tempdir().unwrap();
        let outside = tempdir().unwrap();
        symlink(outside.path(), allowed.path().join("link")).unwrap();
        let policy = PathPolicy::new([allowed.path().to_path_buf()]).unwrap();
        assert!(
            policy
                .resolve(allowed.path(), Path::new("link/private.txt"))
                .is_err()
        );
    }
}
