# --- xml-wizard REDCap logic runtime for R (base R only) -------------------
# Mirrors runtime.py. Values are raw REDCap export strings. Logic results are
# TRUE, FALSE, or NULL (unknown, e.g. an unsupported feature).

rc_get <- function(r, col) {
  if (!(col %in% names(r))) return("")
  v <- r[[col]]
  if (is.na(v)) "" else v
}

rc_is_blank <- function(v) {
  if (is.null(v)) return(TRUE)
  if (is.numeric(v)) return(is.na(v))
  if (is.logical(v)) return(is.na(v))
  is.na(v) || trimws(v) == ""
}

rc_to_number <- function(v) {
  # NA_real_ when not numeric; NULL stays NULL (unknown)
  if (is.null(v)) return(NULL)
  if (is.logical(v)) return(if (is.na(v)) NA_real_ else as.numeric(v))
  if (is.numeric(v)) return(as.numeric(v))
  s <- trimws(as.character(v))
  if (is.na(s) || s == "") return(NA_real_)
  suppressWarnings(as.numeric(s))
}

rc_to_bool <- function(v) {
  if (is.null(v)) return(NULL)
  if (is.logical(v)) return(if (is.na(v)) NULL else v)
  if (is.numeric(v)) return(!is.na(v) && v != 0)
  n <- rc_to_number(v)
  if (!is.na(n)) return(n != 0)
  !rc_is_blank(v)
}

rc_cmp <- function(op, a, b) {
  if (is.null(a) || is.null(b)) return(NULL)
  if (is.logical(a)) a <- if (isTRUE(a)) "1" else "0"
  if (is.logical(b)) b <- if (isTRUE(b)) "1" else "0"
  if ((is.numeric(a) && is.nan(a)) || (is.numeric(b) && is.nan(b))) return(op == "<>")
  na <- rc_to_number(a); nb <- rc_to_number(b)
  if (!is.na(na) && !is.na(nb)) {
    x <- na; y <- nb
  } else {
    x <- if (rc_is_blank(a)) "" else as.character(a)
    y <- if (rc_is_blank(b)) "" else as.character(b)
    if (op %in% c("<", ">", "<=", ">=") && (x == "" || y == "")) return(FALSE)
  }
  switch(op, "=" = x == y, "<>" = x != y, "<" = x < y, ">" = x > y,
         "<=" = x <= y, ">=" = x >= y, NULL)
}

rc_and <- function(...) {
  bools <- lapply(list(...), rc_to_bool)
  if (any(vapply(bools, function(b) identical(b, FALSE), logical(1)))) return(FALSE)
  if (any(vapply(bools, is.null, logical(1)))) return(NULL)
  TRUE
}

rc_or <- function(...) {
  bools <- lapply(list(...), rc_to_bool)
  if (any(vapply(bools, function(b) identical(b, TRUE), logical(1)))) return(TRUE)
  if (any(vapply(bools, is.null, logical(1)))) return(NULL)
  FALSE
}

rc_not <- function(v) {
  b <- rc_to_bool(v)
  if (is.null(b)) NULL else !b
}

rc_n <- function(v) {
  if (is.null(v)) return(NULL)
  n <- rc_to_number(v)
  if (is.na(n)) NaN else n
}

rc_arith <- function(op, a, b) {
  x <- rc_n(a); y <- rc_n(b)
  if (is.null(x) || is.null(y)) return(NULL)
  switch(op, "+" = x + y, "-" = x - y, "*" = x * y,
         "/" = if (y == 0 || is.nan(y)) NaN else x / y, "^" = x ^ y, NULL)
}

rc_nums <- function(args) {
  if (any(vapply(args, is.null, logical(1)))) return(NULL)
  ns <- vapply(args, function(v) { n <- rc_to_number(v); if (is.null(n)) NA_real_ else n }, numeric(1))
  ns[!is.na(ns)]
}

rc_fn_sum <- function(...) { ns <- rc_nums(list(...)); if (is.null(ns)) NULL else if (length(ns)) sum(ns) else NaN }
rc_fn_min <- function(...) { ns <- rc_nums(list(...)); if (is.null(ns)) NULL else if (length(ns)) min(ns) else NaN }
rc_fn_max <- function(...) { ns <- rc_nums(list(...)); if (is.null(ns)) NULL else if (length(ns)) max(ns) else NaN }
rc_fn_mean <- function(...) { ns <- rc_nums(list(...)); if (is.null(ns)) NULL else if (length(ns)) mean(ns) else NaN }
rc_fn_abs <- function(x) { n <- rc_n(x); if (is.null(n)) NULL else abs(n) }
rc_fn_round <- function(x, d = "0") { n <- rc_n(x); if (is.null(n)) NULL else round(n, as.integer(rc_n(d))) }
rc_fn_roundup <- function(x, d = "0") { n <- rc_n(x); k <- 10^as.integer(rc_n(d)); if (is.null(n)) NULL else ceiling(n * k) / k }
rc_fn_rounddown <- function(x, d = "0") { n <- rc_n(x); k <- 10^as.integer(rc_n(d)); if (is.null(n)) NULL else floor(n * k) / k }
rc_fn_if <- function(cond, a, b) { c <- rc_to_bool(cond); if (is.null(c)) NULL else if (c) a else b }
rc_fn_isblankormissingcode <- function(x) if (is.null(x)) NULL else rc_is_blank(x)
rc_fn_isnumber <- function(x) if (is.null(x)) NULL else !is.na(rc_to_number(x))
rc_fn_isinteger <- function(x) { if (is.null(x)) return(NULL); n <- rc_to_number(x); !is.na(n) && n == floor(n) }
rc_s <- function(x) if (is.null(x)) NULL else if (rc_is_blank(x)) "" else as.character(x)
rc_fn_contains <- function(a, b) { a <- rc_s(a); b <- rc_s(b); if (is.null(a) || is.null(b)) NULL else grepl(tolower(b), tolower(a), fixed = TRUE) }
rc_fn_not_contain <- function(a, b) { r <- rc_fn_contains(a, b); if (is.null(r)) NULL else !r }
rc_fn_starts_with <- function(a, b) { a <- rc_s(a); b <- rc_s(b); if (is.null(a) || is.null(b)) NULL else startsWith(tolower(a), tolower(b)) }
rc_fn_ends_with <- function(a, b) { a <- rc_s(a); b <- rc_s(b); if (is.null(a) || is.null(b)) NULL else endsWith(tolower(a), tolower(b)) }
rc_fn_length <- function(a) { a <- rc_s(a); if (is.null(a)) NULL else nchar(a) }
rc_parse_date <- function(v) {
  s <- rc_s(v)
  if (is.null(s)) return(NULL)
  if (tolower(s) == "today") return(as.POSIXct(Sys.Date()))
  for (fmt in c("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%m-%d-%Y", "%d-%m-%Y")) {
    d <- as.POSIXct(strptime(s, fmt, tz = "UTC"))
    if (!is.na(d)) return(d)
  }
  NaN
}
rc_fn_datediff <- function(d1, d2, units = "d", fmt = "ymd", signed = FALSE) {
  a <- rc_parse_date(d1); b <- rc_parse_date(d2)
  if (is.null(a) || is.null(b)) return(NULL)
  if (is.numeric(a) || is.numeric(b)) return(NaN)
  secs <- as.numeric(difftime(b, a, units = "secs"))
  div <- c(y = 31556952, M = 2629746, d = 86400, h = 3600, m = 60, s = 1)
  u <- if (as.character(units) %in% names(div)) div[[as.character(units)]] else 86400
  if (tolower(as.character(fmt)) %in% c("true", "false")) signed <- fmt
  out <- secs / u
  if (isTRUE(rc_to_bool(signed))) out else abs(out)
}
# --- end of runtime --------------------------------------------------------
