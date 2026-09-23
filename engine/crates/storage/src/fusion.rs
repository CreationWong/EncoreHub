//! Rank fusion for hybrid retrieval.
//!
//! Knowledge and Memory retrieval run two independent routes — SQLite FTS5
//! (BM25) and vector similarity — whose scores are not comparable. Reciprocal
//! rank fusion combines them by rank instead of score, so neither route needs
//! normalization or per-corpus weights.

use std::collections::HashMap;

/// Standard RRF damping constant. Larger values flatten the contribution of
/// top ranks; 60 is the value from the original TREC formulation and works
/// without per-corpus tuning.
pub const RRF_K: usize = 60;

/// Fuse ranked result lists with reciprocal rank fusion.
///
/// Each list must already be best-first. An item's fused score is
/// `Σ 1 / (k + rank)` over the lists that contain it, ranks starting at 1, so
/// an item found by both routes outranks one found by either route alone.
/// Every item appears exactly once, keeping the payload of its first
/// occurrence; ties keep first-seen order.
pub fn reciprocal_rank_fusion<T: Clone>(
    lists: &[&[T]],
    id_of: impl Fn(&T) -> &str,
    k: usize,
) -> Vec<(T, f64)> {
    let mut payloads: HashMap<String, T> = HashMap::new();
    let mut scores: HashMap<String, f64> = HashMap::new();
    let mut order: Vec<String> = Vec::new();

    for list in lists {
        for (index, item) in list.iter().enumerate() {
            let id = id_of(item);
            if !payloads.contains_key(id) {
                payloads.insert(id.to_string(), item.clone());
                order.push(id.to_string());
            }
            *scores.entry(id.to_string()).or_insert(0.0) += 1.0 / (k + index + 1) as f64;
        }
    }

    // A stable sort keeps the first-seen order for equal scores.
    order.sort_by(|left, right| scores[right].total_cmp(&scores[left]));
    order
        .into_iter()
        .map(|id| {
            let score = scores[&id];
            let payload = payloads.remove(&id).expect("payload registered with id");
            (payload, score)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal item shape with a stable id for fusion tests.
    #[derive(Clone, Debug, PartialEq)]
    struct Item {
        id: String,
        text: String,
    }

    fn item(id: &str, text: &str) -> Item {
        Item {
            id: id.to_string(),
            text: text.to_string(),
        }
    }

    fn ids(fused: &[(Item, f64)]) -> Vec<String> {
        fused.iter().map(|(item, _)| item.id.clone()).collect()
    }

    #[test]
    fn empty_lists_fuse_to_nothing() {
        let empty: Vec<Item> = Vec::new();
        assert!(reciprocal_rank_fusion(&[&empty], |item| &item.id, RRF_K).is_empty());
        assert!(reciprocal_rank_fusion::<Item>(&[], |item| &item.id, RRF_K).is_empty());
    }

    #[test]
    fn single_list_keeps_rank_order_with_rank_scores() {
        let list = vec![item("a", "A"), item("b", "B")];
        let fused = reciprocal_rank_fusion(&[&list], |item| &item.id, RRF_K);

        assert_eq!(ids(&fused), ["a", "b"]);
        assert!((fused[0].1 - 1.0 / 61.0).abs() < f64::EPSILON);
        assert!((fused[1].1 - 1.0 / 62.0).abs() < f64::EPSILON);
    }

    #[test]
    fn overlap_sums_contributions_and_deduplicates() {
        let lexical = vec![item("b", "lexical-B"), item("a", "lexical-A")];
        let vector = vec![item("a", "vector-A"), item("c", "vector-C")];
        let fused = reciprocal_rank_fusion(&[&lexical, &vector], |item| &item.id, RRF_K);

        // "a" is second in lexical and first in vector, so it leads.
        assert_eq!(ids(&fused), ["a", "b", "c"]);
        let score_a = 1.0 / 62.0 + 1.0 / 61.0;
        assert!((fused[0].1 - score_a).abs() < 1e-12);
        // The payload of the first occurrence wins.
        assert_eq!(fused[0].0.text, "lexical-A");
    }

    #[test]
    fn equal_scores_keep_first_seen_order() {
        let lexical = vec![item("x", "X")];
        let vector = vec![item("y", "Y")];
        let fused = reciprocal_rank_fusion(&[&lexical, &vector], |item| &item.id, RRF_K);

        assert_eq!(ids(&fused), ["x", "y"]);
    }

    #[test]
    fn long_tails_still_accumulate_below_top_ranks() {
        let lexical: Vec<Item> = (0..80)
            .map(|index| item(&format!("l{index}"), "lexical"))
            .collect();
        let vector = vec![item("l79", "vector")];
        let fused = reciprocal_rank_fusion(&[&lexical, &vector], |item| &item.id, RRF_K);

        // l79 ranks 80th lexically (1/140) and 1st in vector (1/61), so it
        // overtakes l0 which only scores 1/61 from lexical.
        assert_eq!(fused[0].0.id, "l79");
        assert_eq!(fused.len(), 80);
    }
}
